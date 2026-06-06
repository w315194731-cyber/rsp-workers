// Route middleware: CORS, auth, rate-limit
import { Context, Hono } from 'hono';
import type { Env } from './types';
import { getCorsHeaders } from './util';
import { verifySessionToken, SESSION_COOKIE_NAME } from './auth';

// CORS middleware wrapper
export function corsMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    const origin = c.req.header('Origin');
    if (c.req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(c.env, origin ?? undefined),
      });
    }
    await next();
  };
}

// OPTIONS handler for CORS preflight
export function corsOptionsHandler(env: Env, origin?: string) {
  const headers = getCorsHeaders(env, origin);
  return new Response(null, { status: 204, headers });
}

// Auth middleware — resolves ctx.user (userId + email)
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env; Variables: { user: { id: string; email: string } } }>, next: () => Promise<void>) => {
    // Check cookie first, then Bearer token
    const cookieHeader = c.req.header('Cookie');
    const authHeader = c.req.header('Authorization');
    let userId: string | null = null;
    let email: string | null = null;

    if (cookieHeader) {
      const cookies = Object.fromEntries(
        cookieHeader.split('; ').map(c2 => {
          const [k, ...v] = c2.split('=');
          return [k, v.join('=')];
        })
      );
      const session = cookies[SESSION_COOKIE_NAME];
      if (session) {
        const [uid, token] = session.split(':');
        if (uid && token) {
          // Verify token against KV session store
          const sessionData = await c.env.KV.get(`session:${session}`);
          if (sessionData) {
            const parsed = JSON.parse(sessionData);
            userId = parsed.user_id;
            email = parsed.email;
          }
        }
      }
    }

    if (!userId && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = await verifySessionToken(token, c.env.JWT_SECRET);
      if (payload) {
        userId = payload.sub;
        email = payload.email;
      }
    }

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    c.set('user', { id: userId, email: email! });
    await next();
  };
}

// getIdParam helper (unused import warning fix)
export function getIdParam(c: Context, param = 'id') {
  return c.req.param(param);
}