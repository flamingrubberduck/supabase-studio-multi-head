/**
 * Embedded-DB orchestration: create / drop a Postgres database inside the
 * existing (default) Postgres instance instead of spinning up a full Docker
 * Compose stack per project.
 *
 * A project created this way uses the shared Kong / Auth / PostgREST from the
 * default stack for any API calls, but has its own isolated Postgres database.
 * Studio routes all pg-meta requests through an encrypted connection string
 * (x-connection-encrypted header) targeting the new database.
 *
 * Requirements:
 *   PG_META_CRYPTO_KEY — must match CRYPTO_KEY in the default pg-meta container
 *   STUDIO_PG_META_URL  — reachable pg-meta endpoint (set automatically in Docker)
 */

import { PG_META_URL } from '@/lib/constants'
import { executeQuery } from './query'
import { encryptString } from './util'
import { POSTGRES_HOST, POSTGRES_PASSWORD, POSTGRES_PORT } from './constants'

/**
 * Extensions to create in every new embedded database.
 * Uses IF NOT EXISTS so missing extensions are silently skipped rather than
 * failing the whole project creation.
 */
const INIT_EXTENSIONS = [
  'pg_stat_statements',
  'pgcrypto',
  'uuid-ossp',
]

/**
 * Runs init SQL against the newly created embedded database by calling the
 * default pg-meta with an encrypted connection string targeting the new DB.
 */
async function initEmbeddedDatabase(ref: string): Promise<void> {
  if (!PG_META_URL) return

  const dbName = embeddedDbName(ref)
  const connStr = `postgresql://supabase_admin:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${dbName}`
  const encryptedConn = encryptString(connStr)

  const sql = INIT_EXTENSIONS.map((ext) => `CREATE EXTENSION IF NOT EXISTS "${ext}";`).join('\n')

  // Call pg-meta directly against the new database via encrypted connection string.
  // Failures are non-fatal — Studio handles missing extensions gracefully.
  try {
    await fetch(`${PG_META_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-connection-encrypted': encryptedConn,
      },
      body: JSON.stringify({ query: sql }),
    })
  } catch {
    // best-effort — don't block project creation if extensions fail
  }
}

/** Canonical database name for an embedded project. */
export function embeddedDbName(ref: string): string {
  return `supabase_${ref}`
}

/** Connection details pointing to the default Postgres host. */
export function embeddedConnectionInfo() {
  return {
    db_host: POSTGRES_HOST,
    db_port: POSTGRES_PORT,
    db_user: 'supabase_admin',
    db_password: POSTGRES_PASSWORD,
  }
}

/**
 * Creates a new Postgres database named `supabase_<ref>` inside the default
 * Postgres instance. The database is owned by `supabase_admin` (a superuser),
 * so Studio can connect to it immediately via encrypted connection string.
 *
 * CREATE DATABASE requires autocommit mode — pg-meta's /query endpoint uses
 * pool.query() which is autocommit by default, so this is safe.
 */
export async function createEmbeddedDatabase(ref: string): Promise<void> {
  const dbName = embeddedDbName(ref)
  const result = await executeQuery({ query: `CREATE DATABASE "${dbName}"` })
  if (result.error) {
    throw new Error(`Failed to create database "${dbName}": ${result.error.message}`)
  }
  await initEmbeddedDatabase(ref)
}

/**
 * Drops the embedded database for a project.
 * Terminates all open connections first so the DROP doesn't block.
 * Errors are silently ignored if the database doesn't exist.
 */
export async function dropEmbeddedDatabase(ref: string): Promise<void> {
  const dbName = embeddedDbName(ref)
  // Terminate connections before DROP to avoid "database is being accessed" errors
  await executeQuery({
    query: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
  })
  const result = await executeQuery({ query: `DROP DATABASE IF EXISTS "${dbName}"` })
  if (result.error) {
    throw new Error(`Failed to drop database "${dbName}": ${result.error.message}`)
  }
}
