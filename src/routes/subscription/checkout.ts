// POST /api/subscription/checkout — Create Creem checkout session
import { Hono } from 'hono';
import type { Env } from '../../types';
import { authMiddleware } from '../../middleware';
import { errorResponse, jsonResponse } from '../../util';

const app = new Hono<{ Bindings: Env; Variables: { user: { id: string; email: string } } }>();

// Creem payment product IDs
const CREEM_PRODUCTS: Record<string, { product_id: string; name: string }> = {
  test: { product_id: 'prod_7AcD42vJpzXskt4H1d4vSr', name: 'RSP Test' },
  pro: { product_id: 'prod_7LEc9oEyc8W66CLkYKyadk', name: 'RSP Pro' },
  lifetime: { product_id: 'prod_4J8cvJKdULHVY8iDlwzKlH', name: 'RSP Lifetime' },
};

app.post('/checkout', authMiddleware(), async (c) => {
  const env = c.env;
  const user = c.get('user');

  const body = await c.req.json<{ plan: string }>();
  const { plan } = body;

  if (!['test', 'pro', 'lifetime'].includes(plan)) {
    return errorResponse('Bad Request', 400, 'plan must be "test", "pro", or "lifetime"');
  }

  const product = CREEM_PRODUCTS[plan];
  if (!product) {
    return errorResponse('Bad Request', 400, 'Invalid plan');
  }

  // Build the Creem checkout URL with referenceId (user's id) for webhook correlation
  const referenceId = user.id;
  const checkoutUrl = `https://www.creem.io/test/payment/${product.product_id}?referenceId=${encodeURIComponent(referenceId)}`;

  // Success/cancel URLs for after payment (user returns to our site)
  const successUrl = `${env.APP_URL}/subscription/success?plan=${plan}`;
  const cancelUrl = `${env.APP_URL}/pricing`;

  // Return the Creem checkout URL
  return jsonResponse({
    checkout_url: checkoutUrl,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
});

export default app;