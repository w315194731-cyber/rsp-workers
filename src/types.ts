// Shared TypeScript types for rsp-workers

export interface Env {
  DB: D1Database;
  R2_BUCKET: R2Bucket;
  R2_BUCKET_NAME: string;
  KV: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  REPLICATE_API_TOKEN: string;
  RESEND_API_KEY: string;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
  APP_URL: string;
  CREEM_API_KEY: string;
  CREEM_WEBHOOK_SECRET: string;
}

export type Plan = 'free' | 'pro' | 'lifetime';
export type JobStatus = 'pending' | 'processing' | 'done' | 'failed' | 'expired';
export type Operation = 'bg_removal' | 'denoise' | 'retouch';

export interface User {
  id: string;
  email: string;
  password_hash: string | null;
  plan: Plan;
  created_at: number;
  updated_at: number;
}

export interface UsageLog {
  id: string;
  user_id: string;
  period_start: number;
  period_end: number;
  images_used: number;
  images_limit: number;
  batch_count: number;
}

export interface Job {
  id: string;
  user_id: string;
  status: JobStatus;
  input_url: string;
  output_url: string | null;
  operation: Operation;
  plan: Plan;
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
  expires_at: number;
}

export interface RateLimitRecord {
  count: number;
  window_start: number;
}

export interface SessionPayload {
  sub: string;       // user_id
  email: string;
  purpose: 'magic_link' | 'session';
  iat: number;
  exp: number;
}

// API response types
export interface ApiError {
  error: string;
  detail?: string;
  upgrade_url?: string;
}