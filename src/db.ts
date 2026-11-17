import pg from 'pg';
import { readFile } from 'node:fs/promises';
import type { Database } from './types.js';

export async function connectDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 10000,
    statement_timeout: 15000, idleTimeoutMillis: 30000 });
  pool.on('error', error => console.error('Idle database connection error:', error.message));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(83719012)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
    const applied = await client.query('SELECT version FROM schema_migrations WHERE version = $1', ['001']);
    if (!applied.rowCount) {
      await client.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', ['001']);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  const db: Database = { query: async <T>(sql: string, values?: unknown[]) => {
    const result = await pool.query(sql, values);
    return { rows: result.rows as T[] };
  } };
  return { db, close: () => pool.end() };
}
