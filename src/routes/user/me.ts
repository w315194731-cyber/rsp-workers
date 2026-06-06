// GET /api/user/me
import { Hono } from 'hono';
import type { Env } from '../../types';
import { jsonResponse } from '../../util';

const app = new Hono<{ Bindings: Env; Variables: { user: { id: string; email: string } } }>();

app.get('/me', async (c) => {
  const { id: userId } = c.get('user');
  const env = c.env;
  const now = Math.floor(Date.now() / 1000);

  // Get user
  const user = await env.DB
    .prepare('SELECT id, email, plan FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string; plan: string }>();

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Get current usage log
  const usage = await env.DB
    .prepare(
      'SELECT images_used, images_limit, period_start, period_end FROM usage_logs WHERE user_id = ? AND period_end > ? ORDER BY period_end DESC LIMIT 1'
    )
    .bind(userId, now)
    .first<{ images_used: number; images_limit: number; period_start: number; period_end: number }>();

  return jsonResponse({
    id: user.id,
    email: user.email,
    plan: user.plan,
    usage: usage ?? {
      images_used: 0,
      images_limit: user.plan === 'pro' ? 200 : 10,
      period_start: now,
      period_end: now + 30 * 24 * 60 * 60,
    },
  });
});

export default app;