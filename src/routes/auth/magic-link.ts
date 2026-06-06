// POST /api/auth/magic-link
import { Hono } from 'hono';
import type { Env } from '../../types';
import { buildMagicLinkToken } from '../../auth';
import { newUuid, errorResponse, jsonResponse } from '../../util';

const app = new Hono<{ Bindings: Env }>();

app.options('/magic-link', (c) => {
  const origin = c.req.header('Origin') ?? '*';
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
});

app.post('/magic-link', async (c) => {
  try {
    const { email } = await c.req.json<{ email: string }>();
    if (!email || !email.includes('@')) {
      return errorResponse('Bad Request', 400, 'Valid email required');
    }

    const env = c.env;
    const now = Math.floor(Date.now() / 1000);
    const userId = newUuid();

    // Upsert user in D1 (create if not exists, plan=free)
    const existing = await env.DB
      .prepare('SELECT id, plan FROM users WHERE email = ?')
      .bind(email)
      .first<{ id: string; plan: string }>();

    let uid = existing?.id;
    if (!existing) {
      uid = userId;
      await env.DB
        .prepare(
          'INSERT INTO users (id, email, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(uid, email, 'free', now, now)
        .run();
    }

    // Generate magic link token
    const token = await buildMagicLinkToken(env, uid!, email);
    const verifyUrl = `${env.APP_URL}/api/auth/verify?token=${token}`;

    // Send email via Resend (fall back to console.log if key not configured)
    if (env.RESEND_API_KEY && env.RESEND_API_KEY !== 'placeholder') {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'RSP <noreply@rst.com>',
            to: email,
            subject: 'Sign in to RSP',
            html: `<p>Click to sign in: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
          }),
        });
        if (!res.ok) {
          console.error('Resend error:', await res.text());
        }
      } catch (e) {
        console.error('Failed to send magic link email:', e);
      }
    } else {
      // Dev fallback — print magic link to console
      console.log(`[DEV] Magic link for ${email}: ${verifyUrl}`);
    }

    return jsonResponse({ message: 'Magic link sent' });
  } catch (err) {
    console.error('Magic link error:', err);
    return errorResponse('Internal Server Error', 500, 'Failed to send magic link');
  }
});

export default app;