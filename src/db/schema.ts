// Drizzle ORM schema for rsp-workers
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash'),
  plan: text('plan', { enum: ['free', 'pro', 'lifetime'] }).default('free').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const usageLogs = sqliteTable('usage_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  periodStart: integer('period_start').notNull(),
  periodEnd: integer('period_end').notNull(),
  imagesUsed: integer('images_used').default(0).notNull(),
  imagesLimit: integer('images_limit').notNull(),
  batchCount: integer('batch_count').default(0).notNull(),
});

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  status: text('status', { enum: ['pending', 'processing', 'done', 'failed', 'expired'] }).notNull(),
  inputUrl: text('input_url').notNull(),
  outputUrl: text('output_url'),
  operation: text('operation', { enum: ['bg_removal', 'denoise', 'retouch'] }).notNull(),
  plan: text('plan', { enum: ['free', 'pro', 'lifetime'] }).notNull(),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
  expiresAt: integer('expires_at').notNull(),
});

// SQL for initializing D1 schema:
// CREATE TABLE IF NOT EXISTS users (
//   id TEXT PRIMARY KEY,
//   email TEXT UNIQUE NOT NULL,
//   password_hash TEXT,
//   plan TEXT DEFAULT 'free' NOT NULL CHECK(plan IN ('free', 'pro', 'lifetime')),
//   created_at INTEGER NOT NULL,
//   updated_at INTEGER NOT NULL
// );
//
// CREATE TABLE IF NOT EXISTS usage_logs (
//   id TEXT PRIMARY KEY,
//   user_id TEXT NOT NULL REFERENCES users(id),
//   period_start INTEGER NOT NULL,
//   period_end INTEGER NOT NULL,
//   images_used INTEGER DEFAULT 0 NOT NULL,
//   images_limit INTEGER NOT NULL,
//   batch_count INTEGER DEFAULT 0 NOT NULL
// );
//
// CREATE TABLE IF NOT EXISTS jobs (
//   id TEXT PRIMARY KEY,
//   user_id TEXT NOT NULL REFERENCES users(id),
//   status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'done', 'failed', 'expired')),
//   input_url TEXT NOT NULL,
//   output_url TEXT,
//   operation TEXT NOT NULL CHECK(operation IN ('bg_removal', 'denoise', 'retouch')),
//   plan TEXT NOT NULL,
//   error_message TEXT,
//   created_at INTEGER NOT NULL,
//   completed_at INTEGER,
//   expires_at INTEGER NOT NULL
// );
//
// CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
// CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
// CREATE INDEX IF NOT EXISTS idx_usage_logs_period_end ON usage_logs(period_end);