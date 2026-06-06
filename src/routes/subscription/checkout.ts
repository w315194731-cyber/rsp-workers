// POST /api/subscription/checkout — Create Stripe checkout session
import { Hono } from 'hono';
import type { Env } from '../../types';
import { authMiddleware } from '../../middleware';
import { errorResponse, jsonResponse } from '../../util';

const app = new Hono<{ Bindings: Env; Variables: { user: { id: string; email: string } } }>();

app.post('/checkout', authMiddleware(), async (c) => {
  const env = c.env;
  const { email } = c.get('user');

  const body = await c.req.json<{ plan: string }>();
  const { plan } = body;

  if (!['pro', 'lifetime'].includes(plan)) {
    return errorResponse('Bad Request', 400, 'plan must be "pro" or "lifetime"');
  }

  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey === 'placeholder') {
    return errorResponse('Service Unavailable', 503, 'Stripe not configured');
  }

  const priceMap: Record<string, { price_id: string; name: string }> = {
    pro: { price_id: 'price_pro_monthly', name: 'RSP Pro' },
    lifetime: { price_id: 'price_lifetime', name: 'RSP Lifetime' },
  };

  const priceData = priceMap[plan];
  if (!priceData) {
    return errorResponse('Bad Request', 400, 'Invalid plan');
  }

  // Build success/cancel URLs
  const successUrl = `${env.APP_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${env.APP_URL}/pricing`;

  let checkoutUrl = '';

  try {
    // Use fetch to call Stripe API directly (no SDK needed)
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'success_url': successUrl,
        'cancel_url': cancelUrl,
        'customer_email': email,
        'metadata[plan]': plan,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': priceData.name,
        'line_items[0][price_data][unit_amount]': plan === 'lifetime' ? '19900' : '1900',
        'line_items[0][price_data][recurring][interval]': plan === 'lifetime' ? 'one_time' : 'month',
        'line_items[0][quantity]': '1',
      }).toString(),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Stripe checkout error:', err);
      return errorResponse('Payment Service Error', 502, 'Failed to create checkout session');
    }

    const session = await response.json() as { id: string; url: string };
    checkoutUrl = session.url;
  } catch (e) {
    console.error('Stripe API call failed:', e);
    return errorResponse('Internal Server Error', 500, 'Failed to reach Stripe');
  }

  return jsonResponse({ checkout_url: checkoutUrl });
});

export default app;