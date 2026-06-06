// Cloudflare Workers entry point for rsp-workers
import { Hono } from 'hono';
import { corsMiddleware, authMiddleware } from './middleware';
import type { Env } from './types';

// Route modules
import authMagicLink from './routes/auth/magic-link';
import authVerify from './routes/auth/verify';
import authLogout from './routes/auth/logout';
import userMe from './routes/user/me';
import uploadPresign from './routes/upload/presign';
import stripeWebhook from './routes/webhook/stripe';
import creemWebhook from './routes/webhook/creem';
import subscriptionCheckout from './routes/subscription/checkout';
import jobRoutes from './routes/job';

const app = new Hono<{ Bindings: Env }>();

// Global CORS middleware (no auth needed for preflight + open endpoints)
app.use('/*', corsMiddleware());

// Open auth routes (no session required to initiate magic link or verify token)
app.route('/api/auth', authMagicLink);
app.route('/api/auth', authVerify);

// Stripe webhook (raw body needed, no auth)
app.route('/api/webhook/stripe', stripeWebhook);

// Creem webhook (raw body needed, no auth)
app.route('/api/webhook/creem', creemWebhook);

// Authenticated routes — require valid session/Bearer token
app.route('/api/auth', authLogout);  // logout needs session to clear cookie
app.route('/api/user', userMe);
app.route('/api/upload', uploadPresign);
app.route('/api/subscription', subscriptionCheckout);
app.route('/api/job', jobRoutes);

// Health check (no auth)
app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;