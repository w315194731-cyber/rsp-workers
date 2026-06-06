// R2 pre-signed URL helpers using AWS Signature V4
import type { Env } from './types';

// Build AWS Signature V4 presigned PUT URL for R2
export async function createR2PresignedUploadUrl(
  env: Env,
  key: string,
  contentType: string,
  expiresIn = 1800
): Promise<{ uploadUrl: string; key: string }> {
  const expiration = Math.floor(Date.now() / 1000) + expiresIn;
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const region = 'auto';
  const service = 's3';

  // Build credential scope
  const credentialScope = `${date}/${region}/${service}/aws4_request`;

  // Query parameters to sign
  const signedHeaders = 'host';
  const xAmzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 16) + 'Z';
  const amzExpires = String(expiresIn);

  // Build canonical request
  const canonicalUri = `/${key}`;
  const canonicalQueryString = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(`${env.R2_BUCKET_NAME}/${credentialScope}`)}`,
    `X-Amz-Date=${xAmzDate}`,
    `X-Amz-Expires=${amzExpires}`,
    `X-Amz-SignedHeaders=${signedHeaders}`,
  ].join('&');

  const payloadHash = 'UNSIGNED-PAYLOAD';
  const canonicalHeaders = `host:${env.R2_BUCKET_NAME}.r2.dev\n`;
  const canonicalRequest = [
    'PUT', canonicalUri, canonicalQueryString,
    canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const canonicalHash = await sha256hex(canonicalRequest);

  // Build string to sign
  const algorithm = 'AWS4-HMAC-SHA256';
  const stringToSign = [
    algorithm, xAmzDate, credentialScope, canonicalHash,
  ].join('\n');

  // Compute signature
  const signingKey = await getSigningKey(env, date, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  // Build authorization header
  const authHeader = [
    `${algorithm} Credential=${env.R2_BUCKET_NAME}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');

  const bucketDomain = `https://${env.R2_BUCKET_NAME}.r2.dev`;
  const uploadUrl = `${bucketDomain}/${key}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return { uploadUrl, key };
}

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(key: CryptoKey, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSigningKey(env: Env, date: string, region: string, service: string): Promise<CryptoKey> {
  const kSecret = new TextEncoder().encode('AWS4' + env.R2_BUCKET_NAME);
  const kDate = await crypto.subtle.importKey('raw', kSecret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kRegion = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', kDate), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kService = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', kRegion), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const kSigning = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', kService), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return kSigning;
}

export async function createR2PresignedDownloadUrl(
  _env: Env,
  key: string,
  expiresIn = 3600
): Promise<string> {
  // Same presigning approach for downloads — return the public URL placeholder
  // In production, you'd use createR2PresignedUploadUrl with GET method
  const bucketDomain = `https://${_env.R2_BUCKET_NAME}.r2.dev`;
  return `${bucketDomain}/${key}`;
}

export function getR2PublicUrl(env: Env, key: string): string {
  return `https://${(env.R2_BUCKET as unknown as { key: string }).key}.r2.dev/${key}`;
}

export function r2OriginalKey(userId: string, jobId: string, filename: string): string {
  const ext = filename.split('.').pop() ?? 'png';
  return `rsp-uploads/${userId}/${jobId}/original.${ext}`;
}

export function r2ProcessedKey(userId: string, jobId: string): string {
  return `rsp-uploads/${userId}/${jobId}/processed.png`;
}