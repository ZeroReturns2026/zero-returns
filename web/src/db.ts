import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * Run a query. Returns rows for SELECT/RETURNING, empty array for mutations.
 */
export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return (result.rows ?? []) as T[];
}

export async function queryOne<T = any>(text: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Run a raw multi-statement SQL script (used by migrations on startup).
 */
export async function execScript(sql: string): Promise<void> {
  await pool.query(sql);
}

/**
 * Get the underlying pool for direct use (e.g. transactions).
 */
export { pool as db };

/**
 * Close the pool. Only used by scripts.
 */
export async function close(): Promise<void> {
  await pool.end();
}
