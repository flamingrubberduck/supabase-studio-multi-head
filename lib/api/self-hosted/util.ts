import crypto from 'crypto-js'

import {
  ENCRYPTION_KEY,
  POSTGRES_DATABASE,
  POSTGRES_HOST,
  POSTGRES_PASSWORD,
  POSTGRES_PORT,
  POSTGRES_USER_READ_ONLY,
  POSTGRES_USER_READ_WRITE,
} from './constants'
import { IS_PLATFORM } from '@/lib/constants'
import { PG_META_URL } from '@/lib/constants'
import { getProject } from './project-registry'

/**
 * Asserts that the current environment is self-hosted.
 */
export function assertSelfHosted() {
  if (IS_PLATFORM) {
    throw new Error('This function can only be called in self-hosted environments')
  }
}

export function encryptString(stringToEncrypt: string): string {
  return crypto.AES.encrypt(stringToEncrypt, ENCRYPTION_KEY).toString()
}

export function getConnectionString({ readOnly }: { readOnly: boolean }) {
  const postgresUser = readOnly ? POSTGRES_USER_READ_ONLY : POSTGRES_USER_READ_WRITE

  return `postgresql://${postgresUser}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DATABASE}`
}

/**
 * Returns the pg-meta base URL for a given project ref.
 * Falls back to the default env-var URL for ref='default' or unknown refs.
 */
export function getProjectMetaUrl(ref: string | undefined): string {
  if (!ref || ref === 'default') return PG_META_URL ?? ''
  const project = getProject(ref)
  return project?.metaUrl ?? PG_META_URL ?? ''
}

/**
 * Returns the GoTrue auth URL and service role key for a given project ref.
 * Falls back to env-var values for ref='default'.
 */
export function getProjectAuthConfig(ref: string | undefined): {
  url: string
  serviceKey: string
} {
  if (!ref || ref === 'default') {
    return {
      url: process.env.SUPABASE_URL ?? '',
      serviceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
    }
  }
  const project = getProject(ref)
  if (!project) {
    return {
      url: process.env.SUPABASE_URL ?? '',
      serviceKey: process.env.SUPABASE_SERVICE_KEY ?? '',
    }
  }
  return { url: project.authUrl, serviceKey: project.serviceRoleKey }
}

/**
 * Returns the Postgres connection string for a given project ref.
 * Falls back to the default env-var connection for ref='default'.
 */
export function getProjectConnectionString(
  ref: string | undefined,
  { readOnly = false }: { readOnly?: boolean } = {}
): string {
  if (!ref || ref === 'default') return getConnectionString({ readOnly })
  const project = getProject(ref)
  if (!project) return getConnectionString({ readOnly })

  const user = readOnly ? POSTGRES_USER_READ_ONLY : POSTGRES_USER_READ_WRITE
  const { host, port, name, password } = project.db
  return `postgresql://${user}:${password}@${host}:${port}/${name}`
}
