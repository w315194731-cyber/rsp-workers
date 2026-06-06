// POST /api/webhook/stripe — Stripe webhook handler
import { Hono } from 'hono';
import type { Env } from '../../types';
import { errorResponse, jsonResponse } from '../../util';

const app = new Hono<{ Bindings: Env }>();

app.post('/', async (c) => {
  const env = c.env;
  const signature = c.req.header('stripe-signature');

  // Read raw body for signature verification
  const rawBody = await c.req.text();
  const webhookSecret = (env.STRIPE_WEBHOOK_SECRET as string) || '';

  if (!signature || !webhookSecret) {
    return errorResponse('Bad Request', 400, 'Missing Stripe signature or webhook secret');
  }

  // Parse signature header: t=timestamp,v1=signature
  const parts: Record<string, string> = {};
  for (const part of signature.split(',')) {
    const [k, v] = part.split('=');
    parts[k.trim()] = v.trim();
  }
  const timestamp = parts['t'];
  const expectedSig = parts['v1'];

  if (!timestamp || !expectedSig) {
    return errorResponse('Unauthorized', 401, 'Invalid signature format');
  }

  // Check timestamp age (5 minute tolerance)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (age > 300) {
    return errorResponse('Unauthorized', 401, 'Webhook timestamp too old');
  }

  // Compute expected HMAC-SHA256
  const toSign = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(toSign));
  const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Timing-safe compare
  let matched = sigHex.length === expectedSig.length;
  for (let i = 0; i < sigHex.length; i++) {
    if (sigHex[i] !== expectedSig[i]) matched = false;
  }
  if (!matched) {
    return errorResponse('Unauthorized', 401, 'Signature mismatch');
  }

  // Parse event
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return errorResponse('Bad Request', 400, 'Invalid JSON body');
  }

  // Handle events
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const customerEmail = session.customer_email as string | undefined;
      const planType = session.metadata?.plan as string | undefined;

      if (!customerEmail) {
        console.error('No customer_email in checkout.session.completed');
        return jsonResponse({ received: true, error: 'No email' });
      }

      // Determine plan
      const plan = planType === 'lifetime' ? 'lifetime' : planType === 'pro' ? 'pro' : 'pro';
      const now = Math.floor(Date.now() / 1000);

      // Update user plan
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

    case 'customer.subscription.deleted': {
      // Downgrade to free
      const now = Math.floor(Date.now() / 1000);
      await env.DB
        .prepare('UPDATE users SET plan = ?, updated_at = ? WHERE id IN (SELECT user_id FROM customers WHERE stripe_customer_id = ?)')
        .bind('free', now, event.data.object.customer as string)
        .run();
      break;
    }

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return jsonResponse({ received: true });
});

export default app;