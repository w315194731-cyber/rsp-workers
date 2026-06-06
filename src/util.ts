// Utility: rate limiting, CORS, helpers
import type { Env, RateLimitRecord } from './types';

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_FREE = 20;
const MAX_PRO = 100;

export function getCorsHeaders(_env: Env, origin?: string) {
  return {
    'Access-Control-Allow-Origin': origin ?? _env.CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function checkRateLimit(
  env: Env,
  key: string,
  isPro: boolean
): Promise<{ allowed: boolean; remaining: number }> {
  const limit = isPro ? MAX_PRO : MAX_FREE;
  const raw = await env.KV.get(key);
  const now = Date.now();
  let record: RateLimitRecord = raw ? JSON.parse(raw) : { count: 0, window_start: now };

  if (now - record.window_start > WINDOW_MS) {
    record = { count: 0, window_start: now };
  }

  if (record.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  record.count++;
  await env.KV.put(key, JSON.stringify(record), { expirationTtl: 86400 });
  return { allowed: true, remaining: limit - record.count };
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function jsonResponse<T>(data: T, init: ResponseInit = {}): Response {
  const origin = init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)
    ? (init.headers as Record<string, string>)['Origin'] ?? '*'
    : '*';
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export function errorResponse(error: string, status = 400, detail?: string, upgradeUrl?: string): Response {
  return jsonResponse({ error, detail, upgrade_url: upgradeUrl }, { status });
}

export function r2Key(userId: string, jobId: string, filename: string, isProcessed = false): string {
  const ext = filename.split('.').pop() ?? 'png';
  const suffix = isProcessed ? 'processed.png' : `original.${ext}`;
  return `rsp-uploads/${userId}/${jobId}/${suffix}`;
}