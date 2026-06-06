// Auth utilities: JWT, session management
import { SignJWT, jwtVerify } from 'jose';
import type { SessionPayload, Env } from './types';

const SESSION_COOKIE_NAME = 'rsp_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getJwtSecret(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export function buildMagicLinkToken(env: Env, userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email, purpose: 'magic_link' } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000 + MAGIC_LINK_TTL_MS / 1000))
    .sign(getJwtSecret(env));
}

export async function verifyMagicLinkToken(env: Env, token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env));
    if (payload.purpose !== 'magic_link') return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function buildSessionToken(env: Env, userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email, purpose: 'session' } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000 + SESSION_TTL_MS / 1000))
    .sign(getJwtSecret(env));
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export function parseSessionCookie(cookieHeader: string | null): { userId: string; token: string } | null {
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(
    cookieHeader.split('; ').map(c => {
      const [k, ...v] = c.split('=');
      return [k, v.join('=')];
    })
  );
  const session = cookies[SESSION_COOKIE_NAME];
  if (!session) return null;
  const [userId, token] = session.split(':');
  if (!userId || !token) return null;
  return { userId, token };
}

export function makeSessionCookie(value: string, _env: Env): string {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toUTCString();
  return `${SESSION_COOKIE_NAME}=${value}; Expires=${expires}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export { SESSION_COOKIE_NAME, SESSION_TTL_MS };