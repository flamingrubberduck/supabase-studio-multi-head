import { describe, expect, it } from 'vitest'

import {
  generateAnonKey,
  generateJwtSecret,
  generatePostgresPassword,
  generateServiceRoleKey,
} from './jwt-generator'

function decodeJwt(token: string): { header: any; payload: any } {
  const [h, p] = token.split('.')
  const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf-8'))
  return { header: decode(h), payload: decode(p) }
}

function verifyJwtSignature(token: string, secret: string): boolean {
  const crypto = require('crypto')
  const [header, payload, sig] = token.split('.')
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return expected === sig
}

describe('jwt-generator', () => {
  describe('generateJwtSecret', () => {
    it('returns a non-empty string', () => {
      expect(generateJwtSecret()).toBeTruthy()
    })

    it('returns different values each call', () => {
      expect(generateJwtSecret()).not.toBe(generateJwtSecret())
    })

    it('returns a base64url string (no +, /, =)', () => {
      const secret = generateJwtSecret()
      expect(secret).not.toMatch(/[+/=]/)
    })
  })

  describe('generatePostgresPassword', () => {
    it('returns a hex string of 32 chars', () => {
      const pw = generatePostgresPassword()
      expect(pw).toMatch(/^[0-9a-f]{32}$/)
    })

    it('returns different values each call', () => {
      expect(generatePostgresPassword()).not.toBe(generatePostgresPassword())
    })
  })

  describe('generateAnonKey', () => {
    it('returns a three-part JWT', () => {
      const key = generateAnonKey('test-secret')
      expect(key.split('.')).toHaveLength(3)
    })

    it('uses HS256 algorithm', () => {
      const { header } = decodeJwt(generateAnonKey('test-secret'))
      expect(header.alg).toBe('HS256')
      expect(header.typ).toBe('JWT')
    })

    it('encodes role=anon in payload', () => {
      const { payload } = decodeJwt(generateAnonKey('test-secret'))
      expect(payload.role).toBe('anon')
      expect(payload.iss).toBe('supabase')
    })

    it('produces a valid HMAC signature', () => {
      const secret = 'my-test-secret-key'
      const key = generateAnonKey(secret)
      expect(verifyJwtSignature(key, secret)).toBe(true)
    })

    it('signature is invalid with wrong secret', () => {
      const key = generateAnonKey('correct-secret')
      expect(verifyJwtSignature(key, 'wrong-secret')).toBe(false)
    })
  })

  describe('generateServiceRoleKey', () => {
    it('encodes role=service_role in payload', () => {
      const { payload } = decodeJwt(generateServiceRoleKey('test-secret'))
      expect(payload.role).toBe('service_role')
    })

    it('produces a valid HMAC signature', () => {
      const secret = 'my-test-secret-key'
      const key = generateServiceRoleKey(secret)
      expect(verifyJwtSignature(key, secret)).toBe(true)
    })

    it('anon and service_role keys differ for the same secret', () => {
      const secret = 'shared-secret'
      expect(generateAnonKey(secret)).not.toBe(generateServiceRoleKey(secret))
    })
  })
})
