// POST /api/webhook/creem — Creem webhook handler
import { Hono } from 'hono';
import type { Env } from '../../types';
import { errorResponse, jsonResponse } from '../../util';

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const env = c.env;
  const signature = c.req.header('creem-signature');

  // Read raw body for signature verification
  const rawBody = await c.req.text();
  const webhookSecret = (env.CREEM_WEBHOOK_SECRET as string) || '';

  if (!signature || !webhookSecret) {
    return errorResponse('Bad Request', 400, 'Missing creem-signature or webhook secret');
  }

  // Compute expected HMAC-SHA256
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Timing-safe compare
  let matched = sigHex.length === signature.length;
  for (let i = 0; i < sigHex.length; i++) {
    if (sigHex[i] !== signature[i]) matched = false;
  }
  if (!matched) {
    return errorResponse('Unauthorized', 401, 'Signature mismatch');
  }

  // Parse event
  let event: { event: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return errorResponse('Bad Request', 400, 'Invalid JSON body');
  }

  console.log(`Creem webhook: ${event.event}`);

  // Handle events
  switch (event.event) {
    case 'checkout.completed': {
      const data = event.data as {
        customer_email?: string;
        product?: { name?: string };
        metadata?: { referenceId?: string };
      };
      const customerEmail = data.customer_email;
      const productName = data.product?.name ?? '';
      const userId = data.metadata?.referenceId as string | undefined;

      if (!customerEmail) {
        console.error('No customer_email in checkout.completed');
        return jsonResponse({ received: true, error: 'No email' });
      }

      // Determine plan from product name
      const plan = productName.toLowerCase().includes('lifetime') ? 'lifetime' : 'pro';
      const now = Math.floor(Date.now() / 1000);

      // Update user plan (upsert)
      await env.DB
        .prepare('UPDATE users SET plan = ?, updated_at = ? WHERE email = ?')
        .bind(plan, now, customerEmail)
        .run();

      // Create usage log with higher limits
      const periodEnd = plan === 'lifetime'
        ? now + 365 * 10 * 24 * 60 * 60
        : now + 30 * 24 * 60 * 60;
      const imagesLimit = plan === 'lifetime' ? 999999 : 200;

      await env.DB
        .prepare(
          `INSERT INTO usage_logs (id, user_id, period_start, period_end, images_used, images_limit, batch_count)
           SELECT ?, id, ?, ?, 0, ?, 0 FROM users WHERE email = ?`
        )
        .bind(crypto.randomUUID(), now, periodEnd, imagesLimit, customerEmail)
        .run();

      console.log(`Plan upgraded: ${customerEmail} -> ${plan}`);
      break;
    }

    case 'subscription.active':
    case 'subscription.paid': {
      // Subscription is now active - grant access
      const data = event.data as {
        customer_email?: string;
        product?: { name?: string };
        metadata?: { referenceId?: string };
      };
      const customerEmail = data.customer_email;

      if (!customerEmail) {
        console.error('No customer_email in subscription event');
        return jsonResponse({ received: true, error: 'No email' });
      }

      const plan = 'pro';
      const now = Math.floor(Date.now() / 1000);

      await env.DB
        .prepare('UPDATE users SET plan = ?, updated_at = ? WHERE email = ?')
        .bind(plan, now, customerEmail)
        .run();

      const periodEnd = now + 30 * 24 * 60 * 60;
      await env.DB
        .prepare(
          `INSERT INTO usage_logs (id, user_id, period_start, period_end, images_used, images_limit, batch_count)
           SELECT ?, id, ?, ?, 0, 200, 0 FROM users WHERE email = ?`
        )
        .bind(crypto.randomUUID(), now, periodEnd, customerEmail)
        .run();

      console.log(`Subscription activated: ${customerEmail}`);
      break;
    }

    case 'subscription.canceled': {
      // Subscription canceled - downgrade to free
      const data = event.data as { customer_email?: string };
      const customerEmail = data.customer_email;

      if (!customerEmail) {
        console.error('No customer_email in subscription.canceled');
        return jsonResponse({ received: true, error: 'No email' });
      }

      const now = Math.floor(Date.now() / 1000);
      await env.DB
        .prepare('UPDATE users SET plan = ?, updated_at = ? WHERE email = ?')
        .bind('free', now, customerEmail)
        .run();

      console.log(`Subscription canceled: ${customerEmail} -> free`);
      break;
    }

    case 'subscription.past_due': {
      console.log(`Subscription past due for event data: ${JSON.stringify(event.data)}`);
      break;
    }

    case 'refund.created': {
      console.log(`Refund created: ${JSON.stringify(event.data)}`);
      break;
    }

    default:
      console.log(`Unhandled Creem event: ${event.event}`);
  }

  return jsonResponse({ received: true });
});

export default app;
