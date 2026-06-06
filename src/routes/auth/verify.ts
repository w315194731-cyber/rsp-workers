// GET /api/auth/verify?token=***
import { Hono } from 'hono';
import type { Env } from '../../types';
import { verifyMagicLinkToken, buildSessionToken, makeSessionCookie } from '../../auth';
import { errorResponse } from '../../util';

const app = new Hono<{ Bindings: Env }>();

app.get('/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    return errorResponse('Bad Request', 400, 'token query param required');
  }

  const env = c.env;
  const payload = await verifyMagicLinkToken(env, token);
  if (!payload) {
    return errorResponse('Unauthorized', 401, 'Invalid or expired token');
  }

  // Build session JWT and persist in KV
  const sessionToken = await buildSessionToken(env, payload.sub, payload.email);
  const sessionKey = `session:${payload.sub}:${crypto.randomUUID().slice(0, 8)}`;
  const sessionValue = JSON.stringify({ user_id: payload.sub, email: payload.email });
  await env.KV.put(sessionKey, sessionValue, { expirationTtl: 7 * 24 * 60 * 60 });

  // Extract a short token suffix for the cookie value
  const tokenSuffix = sessionToken.split('.')[2]?.slice(0, 16) ?? '';
  const cookie = makeSessionCookie(`${payload.sub}:${tokenSuffix}`, env);

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${env.APP_URL}/editor`,
      'Set-Cookie': cookie,
    },
  });
});

export default app;