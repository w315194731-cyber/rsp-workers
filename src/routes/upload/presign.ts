// POST /api/upload/presign
import { Hono } from 'hono';
import type { Env } from '../../types';
import { newUuid, errorResponse, jsonResponse } from '../../util';
import { createR2PresignedUploadUrl, r2OriginalKey } from '../../r2';

const app = new Hono<{ Bindings: Env; Variables: { user: { id: string; email: string } } }>();

app.post('/presign', async (c) => {
  const { id: userId, email } = c.get('user');
  const env = c.env;
  const now = Math.floor(Date.now() / 1000);

  const body = await c.req.json<{
    filename: string;
    content_type: string;
    operation: string;
  }>();
  const { filename, content_type, operation } = body;

  if (!filename || !content_type || !operation) {
    return errorResponse('Bad Request', 400, 'filename, content_type, operation required');
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(content_type)) {
    return errorResponse('Bad Request', 400, 'Only JPEG, PNG, WebP supported');
  }

  if (!['bg_removal', 'denoise', 'retouch'].includes(operation)) {
    return errorResponse('Bad Request', 400, 'Invalid operation');
  }

  // Check plan usage
  const user = await env.DB
    .prepare('SELECT id, plan FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; plan: string }>();

  if (!user) return errorResponse('Unauthorized', 401);

  const usage = await env.DB
    .prepare(
      'SELECT images_used, images_limit FROM usage_logs WHERE user_id = ? AND period_end > ? ORDER BY period_end DESC LIMIT 1'
    )
    .bind(userId, now)
    .first<{ images_used: number; images_limit: number }>();

  if (usage && usage.images_used >= usage.images_limit) {
    return errorResponse('Rate limit exceeded', 429, undefined, '/pricing');
  }

  // Create job in D1
  const jobId = newUuid();
  const r2Key = r2OriginalKey(userId, jobId, filename);
  const expiresAt = now + 86400; // 24h

  await env.DB
    .prepare(
      `INSERT INTO jobs (id, user_id, status, input_url, operation, plan, created_at, expires_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .bind(jobId, userId, r2Key, operation, user.plan, now, expiresAt)
    .run();

  // Write KV entry to prevent duplicate uploads
  await env.KV.put(
    `upload_presign:${jobId}`,
    JSON.stringify({ user_id: userId, created_at: now }),
    { expirationTtl: 1800 }
  );

  // Generate R2 pre-signed upload URL (30 min)
  const { uploadUrl } = await createR2PresignedUploadUrl(env, r2Key, content_type, 1800);

  return jsonResponse({
    job_id: jobId,
    upload_url: uploadUrl,
    method: 'PUT',
    headers: { 'Content-Type': content_type },
  });
});

export default app;