// POST /api/job — Create a new image processing job
import { Hono } from 'hono';
import type { Env } from '../../types';
import { authMiddleware } from '../../middleware';
import { newUuid, errorResponse, jsonResponse } from '../../util';
import { r2OriginalKey, r2ProcessedKey } from '../../r2';

const app = new Hono<{ Bindings: Env; Variables: { user: { id: string; email: string } } }>();

app.post('/', authMiddleware(), async (c) => {
  const { id: userId, email } = c.get('user');
  const env = c.env;
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    job_id: string;
    operation: string;
    input_url?: string;
  }>();
  const { job_id: existingJobId, operation, input_url } = body;

  if (!operation || !['bg_removal', 'denoise', 'retouch'].includes(operation)) {
    return errorResponse('Bad Request', 400, 'Valid operation required: bg_removal, denoise, retouch');
  }

  let jobId = existingJobId;
  let r2Key = input_url;

  // If no existing job_id, create a new job from scratch (upload happened separately)
  if (!jobId) {
    return errorResponse('Bad Request', 400, 'job_id required (from presign flow)');
  }

  // Verify the job belongs to this user and is in pending state
  const job = await env.DB
    .prepare('SELECT id, user_id, status, input_url FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<{ id: string; user_id: string; status: string; input_url: string }>();

  if (!job) {
    return errorResponse('Not Found', 404, 'Job not found');
  }

  if (job.user_id !== userId) {
    return errorResponse('Forbidden', 403, 'Job does not belong to this user');
  }

  if (job.status !== 'pending') {
    return errorResponse('Conflict', 409, `Job already ${job.status}`);
  }

  // Get user plan for processing
  const user = await env.DB
    .prepare('SELECT id, plan FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; plan: string }>();

  if (!user) return errorResponse('Unauthorized', 401);

  // Mark as processing
  await env.DB
    .prepare('UPDATE jobs SET status = ? WHERE id = ?')
    .bind('processing', jobId)
    .run();

  // Update usage count
  await env.DB
    .prepare(
      'UPDATE usage_logs SET images_used = images_used + 1 WHERE user_id = ? AND period_end > ?'
    )
    .bind(userId, now)
    .run();

  // Trigger background processing (fire-and-forget for now)
  // In production this would be a separate queue worker
  processImageJob(env, jobId, job.input_url, operation, user.plan).catch(err => {
    console.error(`Job ${jobId} processing error:`, err);
  });

  return jsonResponse({
    job_id: jobId,
    status: 'processing',
    message: 'Job queued for processing',
  });
});

// GET /api/job/:id — Get job status
app.get('/:id', authMiddleware(), async (c) => {
  const { id: userId } = c.get('user');
  const env = c.env;
  const jobId = c.req.param('id');

  const job = await env.DB
    .prepare('SELECT id, status, operation, input_url, output_url, plan, error_message, created_at, completed_at, expires_at FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<{
      id: string;
      status: string;
      operation: string;
      input_url: string;
      output_url: string | null;
      plan: string;
      error_message: string | null;
      created_at: number;
      completed_at: number | null;
      expires_at: number;
    }>();

  if (!job) {
    return errorResponse('Not Found', 404, 'Job not found');
  }

  if (job.status === 'pending' || job.status === 'processing') {
    return jsonResponse({
      id: job.id,
      status: job.status,
      operation: job.operation,
      created_at: job.created_at,
    });
  }

  return jsonResponse({
    id: job.id,
    status: job.status,
    operation: job.operation,
    input_url: job.input_url,
    output_url: job.output_url,
    error_message: job.error_message,
    completed_at: job.completed_at,
    expires_at: job.expires_at,
  });
});

// Background image processing function
async function processImageJob(
  env: Env,
  jobId: string,
  inputR2Key: string,
  operation: string,
  plan: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Build R2 object URL for input
    const inputUrl = `https://${env.R2_BUCKET_NAME}.r2.cloudflarestorage.com/${inputR2Key}`;

    let outputUrl = '';

    if (operation === 'bg_removal') {
      outputUrl = await processBackgroundRemoval(env, inputUrl);
    } else if (operation === 'denoise') {
      outputUrl = await processDenoise(env, inputUrl);
    } else if (operation === 'retouch') {
      outputUrl = await processRetouch(env, inputUrl);
    }

    // Save output to R2
    if (outputUrl) {
      const outputR2Key = r2ProcessedKey(userId, jobId);
      // Copy processed image to R2 (simplified — in production use R2 API directly)
      const response = await fetch(outputUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        await env.R2_BUCKET.put(outputR2Key, arrayBuffer, {
          httpMetadata: { contentType: 'image/png' },
        });
        outputUrl = outputR2Key;
      }
    }

    // Update job as done
    await env.DB
      .prepare(
        'UPDATE jobs SET status = ?, output_url = ?, completed_at = ? WHERE id = ?'
      )
      .bind('done', outputUrl, now, jobId)
      .run();

    console.log(`Job ${jobId} completed: ${operation}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Job ${jobId} failed:`, errorMessage);

    await env.DB
      .prepare('UPDATE jobs SET status = ?, error_message = ? WHERE id = ?')
      .bind('failed', errorMessage, jobId)
      .run();
  }
}

async function processBackgroundRemoval(env: Env, inputUrl: string): Promise<string> {
  const replicateToken = env.REPLICATE_API_TOKEN;

  if (!replicateToken || replicateToken === 'placeholder') {
    // Dev fallback: return a placeholder URL
    console.log(`[DEV] Would process bg_removal for ${inputUrl} using RMBG-1.4`);
    await new Promise(resolve => setTimeout(resolve, 2000)); // simulate processing
    return `https://placeholder.processed/${crypto.randomUUID()}.png`;
  }

  try {
    // Call Replicate RMBG-1.4 API
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${replicateToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'b774426ee01732f2a62af4988928b1b4b5faad2dc5f6a8ede5b4d10e2a5c8f5',
        input: {
          image: inputUrl,
          alpha_matting: true,
          alpha_matting_foreground_relative: '0.5',
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Replicate API error: ${err}`);
    }

    const prediction = await response.json() as { id: string; status: string; urls?: { get: string } };
    const pollUrl = prediction.urls?.get;

    if (!pollUrl) {
      throw new Error('No polling URL returned from Replicate');
    }

    // Poll until done
    let resultUrl = '';
    for (let i = 0; i < 60; i++) { // max 60 polls (~5 min)
      await new Promise(resolve => setTimeout(resolve, 5000));
      const statusResp = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${replicateToken}` },
      });
      const status = await statusResp.json() as { status: string; output?: { image: string } };
      if (status.status === 'succeeded') {
        resultUrl = status.output?.image ?? '';
        break;
      }
      if (status.status === 'failed') {
        throw new Error('Replicate prediction failed');
      }
    }

    return resultUrl;
  } catch (e) {
    console.error('Replicate call failed:', e);
    throw e;
  }
}

async function processDenoise(_env: Env, inputUrl: string): Promise<string> {
  // Placeholder for denoise processing
  console.log(`[DEV] Would process denoise for ${inputUrl}`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  return `https://placeholder.processed/${crypto.randomUUID()}.png`;
}

async function processRetouch(_env: Env, inputUrl: string): Promise<string> {
  // Placeholder for retouch processing
  console.log(`[DEV] Would process retouch for ${inputUrl}`);
  await new Promise(resolve => setTimeout(resolve, 1500));
  return `https://placeholder.processed/${crypto.randomUUID()}.png`;
}

export default app;