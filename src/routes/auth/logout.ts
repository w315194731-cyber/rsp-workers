// POST /api/auth/logout
import { Hono } from 'hono';
import { clearSessionCookie } from '../../auth';

const app = new Hono();

app.post('/logout', async (c) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': clearSessionCookie(),
    },
  });
});

export default app;