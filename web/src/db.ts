import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '../data/hey-tailor.db');

// Ensure the parent directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
// Note: WAL mode is faster but needs filesystem support for shared memory.
// Default rollback journal works everywhere (local dev, CI, Docker, WSL, etc).
db.exec('PRAGMA foreign_keys = ON');

/**
 * Convert Postgres-style `$1, $2` placeholders to SQLite `?, ?`.
 * Routes and services were originally written for pg; translating at
 * query time means we don't have to edit every call site.
 */
function translate(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?');
}

/**
 * Run a SELECT query. Async signature preserved so route handlers that
 * `await` these calls still work without changes.
 */
export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const sql = translate(text);
  const trimmed = sql.trim().toLowerCase();
  const stmt = db.prepare(sql);
  if (
    trimmed.startsWith('select') ||
    trimmed.startsWith('with') ||
    trimmed.includes('returning')
  ) {
    return stmt.all(...params) as T[];
  }
  stmt.run(...params);
  return [] as T[];
}

export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a raw multi-statement SQL script (used by migrate.ts).
 */
export function execScript(sql: string): void {
  db.exec(sql);
}

/**
 * Close the underlying DB. Only used by scripts.
 */
export function close(): void {
  db.close();
}
