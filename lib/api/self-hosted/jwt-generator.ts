/**
 * Generates JWT keys for new self-hosted projects.
 * Uses Node's built-in crypto — no external dependencies.
 */

import crypto from 'crypto'

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function signHS256(payload: object, secret: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = base64url(crypto.createHmac('sha256', secret).update(data).digest())
  return `${data}.${sig}`
}

export function generateJwtSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function generatePostgresPassword(): string {
  return crypto.randomBytes(16).toString('hex')
}

const FAR_FUTURE = Math.floor(new Date('2099-01-01').getTime() / 1000)

export function generateAnonKey(jwtSecret: string): string {
  return signHS256(
    { role: 'anon', iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: FAR_FUTURE },
    jwtSecret
  )
}

export function generateServiceRoleKey(jwtSecret: string): string {
  return signHS256(
    {
      role: 'service_role',
      iss: 'supabase',
      iat: Math.floor(Date.now() / 1000),
      exp: FAR_FUTURE,
    },
    jwtSecret
  )
}
