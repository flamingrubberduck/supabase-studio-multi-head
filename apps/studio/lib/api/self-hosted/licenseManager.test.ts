// @vitest-environment node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'test-secret-32-chars-long-enough!!'

function makeJwt(payload: Record<string, unknown>, secret = SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

async function freshModule() {
  delete (globalThis as any).__licenseInitialized
  delete (globalThis as any).__licenseState
  vi.resetModules()
  return import('./licenseManager')
}

describe('licenseManager', () => {
  let tmpDir: string
  const originalEnv = { ...process.env }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-test-'))
    process.env.STUDIO_DATA_DIR = tmpDir
    delete process.env.MULTI_HEAD_LICENSE_SERVER_URL
    delete process.env.MULTI_HEAD_LICENSE_SECRET
    delete process.env.MULTI_HEAD_LICENSE_KEY
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.assign(process.env, originalEnv)
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k]
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete (globalThis as any).__licenseInitialized
    delete (globalThis as any).__licenseState
  })

  // ── Self-hosted (no license server) ────────────────────────────────────────

  describe('no MULTI_HEAD_LICENSE_SERVER_URL', () => {
    it('defaults to Enterprise tier without any key', async () => {
      const m = await freshModule()
      m.initLicense()
      expect(m.getLicenseTier()).toBe('enterprise')
    })

    it('requireTier returns ok:true for all features', async () => {
      const m = await freshModule()
      m.initLicense()
      expect(m.requireTier('failover')).toEqual({ ok: true })
      expect(m.requireTier('cluster')).toEqual({ ok: true })
      expect(m.requireTier('cluster-failover')).toEqual({ ok: true })
    })

    it('requirePro (compat alias) returns ok:true', async () => {
      const m = await freshModule()
      m.initLicense()
      expect(m.requirePro()).toEqual({ ok: true })
    })

    it('getLicenseStatus reports enterprise, no grace', async () => {
      const m = await freshModule()
      m.initLicense()
      const status = m.getLicenseStatus()
      expect(status.tier).toBe('enterprise')
      expect(status.grace).toBe(false)
    })
  })

  // ── Managed mode (license server configured, no key) ───────────────────────

  describe('MULTI_HEAD_LICENSE_SERVER_URL set, no key', () => {
    beforeEach(() => {
      process.env.MULTI_HEAD_LICENSE_SERVER_URL = 'https://license.example.com'
      process.env.MULTI_HEAD_LICENSE_SECRET = SECRET
    })

    it('defaults to Free tier when no key present', async () => {
      const m = await freshModule()
      m.initLicense()
      expect(m.getLicenseTier()).toBe('free')
    })

    it('requireTier returns ok:false for business features', async () => {
      const m = await freshModule()
      m.initLicense()
      const result = m.requireTier('failover')
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Business/)
    })

    it('requireTier returns ok:false for enterprise features', async () => {
      const m = await freshModule()
      m.initLicense()
      const result = m.requireTier('cluster')
      expect(result.ok).toBe(false)
      expect(result.message).toMatch(/Enterprise/)
    })
  })

  // ── activateLicenseKey ──────────────────────────────────────────────────────

  describe('activateLicenseKey', () => {
    beforeEach(() => {
      process.env.MULTI_HEAD_LICENSE_SERVER_URL = 'https://license.example.com'
      process.env.MULTI_HEAD_LICENSE_SECRET = SECRET
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ active: true }), { status: 200 })
      )
    })

    it('activates a legacy pro JWT → business tier', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'pro', email: 'owner@example.com' })
      const err = await m.activateLicenseKey(key)
      expect(err).toBeNull()
      expect(m.getLicenseTier()).toBe('business')
    })

    it('activates a business JWT → business tier', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'business', email: 'owner@example.com' })
      const err = await m.activateLicenseKey(key)
      expect(err).toBeNull()
      expect(m.getLicenseTier()).toBe('business')
    })

    it('activates an enterprise JWT → enterprise tier', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'enterprise', email: 'owner@example.com' })
      const err = await m.activateLicenseKey(key)
      expect(err).toBeNull()
      expect(m.getLicenseTier()).toBe('enterprise')
    })

    it('business tier allows business features but not enterprise', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'business', email: 'owner@example.com' })
      await m.activateLicenseKey(key)
      expect(m.requireTier('failover').ok).toBe(true)
      expect(m.requireTier('replica').ok).toBe(true)
      expect(m.requireTier('cluster').ok).toBe(false)
      expect(m.requireTier('cluster-failover').ok).toBe(false)
    })

    it('enterprise tier allows all features', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'enterprise', email: 'owner@example.com' })
      await m.activateLicenseKey(key)
      expect(m.requireTier('failover').ok).toBe(true)
      expect(m.requireTier('cluster').ok).toBe(true)
      expect(m.requireTier('cluster-failover').ok).toBe(true)
    })

    it('persists the key to disk', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'business', email: 'owner@example.com' })
      await m.activateLicenseKey(key)
      const licenseFile = path.join(tmpDir, 'license.json')
      expect(fs.existsSync(licenseFile)).toBe(true)
      const stored = JSON.parse(fs.readFileSync(licenseFile, 'utf-8'))
      expect(stored.key).toBe(key)
    })

    it('rejects a key signed with the wrong secret', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'business' }, 'wrong-secret')
      const err = await m.activateLicenseKey(key)
      expect(err).toMatch(/signature/)
      expect(m.getLicenseTier()).toBe('free')
    })

    it('rejects an unknown tier key', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'starter' })
      const err = await m.activateLicenseKey(key)
      expect(err).toMatch(/tier/)
      expect(m.getLicenseTier()).toBe('free')
    })

    it('fails when MULTI_HEAD_LICENSE_SECRET is absent', async () => {
      delete process.env.MULTI_HEAD_LICENSE_SECRET
      const m = await freshModule()
      const key = makeJwt({ tier: 'business' })
      const err = await m.activateLicenseKey(key)
      expect(err).toMatch(/MULTI_HEAD_LICENSE_SECRET/)
    })

    it('exposes email from JWT in getLicenseStatus', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'business', email: 'owner@example.com' })
      await m.activateLicenseKey(key)
      const status = m.getLicenseStatus()
      expect(status.email).toBe('owner@example.com')
    })
  })

  // ── deactivateLicense ───────────────────────────────────────────────────────

  describe('deactivateLicense', () => {
    beforeEach(() => {
      process.env.MULTI_HEAD_LICENSE_SERVER_URL = 'https://license.example.com'
      process.env.MULTI_HEAD_LICENSE_SECRET = SECRET
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ active: true }), { status: 200 })
      )
    })

    it('downgrades to Free and removes persisted key', async () => {
      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'business', email: 'owner@example.com' })
      await m.activateLicenseKey(key)
      expect(m.getLicenseTier()).toBe('business')

      m.deactivateLicense()
      expect(m.getLicenseTier()).toBe('free')
      const licenseFile = path.join(tmpDir, 'license.json')
      expect(fs.existsSync(licenseFile)).toBe(false)
    })
  })

  // ── initLicense — persisted key on disk ────────────────────────────────────

  describe('initLicense with persisted key', () => {
    beforeEach(() => {
      process.env.MULTI_HEAD_LICENSE_SERVER_URL = 'https://license.example.com'
      process.env.MULTI_HEAD_LICENSE_SECRET = SECRET
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ active: true }), { status: 200 })
      )
    })

    it('loads a persisted legacy pro key → business tier', async () => {
      const key = makeJwt({ tier: 'pro', email: 'owner@example.com' })
      fs.mkdirSync(tmpDir, { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'license.json'), JSON.stringify({ key }))

      const m = await freshModule()
      m.initLicense()
      expect(m.getLicenseTier()).toBe('business')
    })

    it('loads a persisted enterprise key → enterprise tier', async () => {
      const key = makeJwt({ tier: 'enterprise', email: 'owner@example.com' })
      fs.mkdirSync(tmpDir, { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'license.json'), JSON.stringify({ key }))

      const m = await freshModule()
      m.initLicense()
      expect(m.getLicenseTier()).toBe('enterprise')
    })

    it('ignores a persisted key with bad signature', async () => {
      const key = makeJwt({ tier: 'business' }, 'wrong-secret')
      fs.mkdirSync(tmpDir, { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'license.json'), JSON.stringify({ key }))

      const m = await freshModule()
      m.initLicense()
      expect(m.getLicenseTier()).toBe('free')
    })
  })

  // ── Server revocation (polling) ────────────────────────────────────────────

  describe('server revocation via polling', () => {
    beforeEach(() => {
      process.env.MULTI_HEAD_LICENSE_SERVER_URL = 'https://license.example.com'
      process.env.MULTI_HEAD_LICENSE_SECRET = SECRET
    })

    it('downgrades to Free when server reports active:false', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ active: true }), { status: 200 }))

      const m = await freshModule()
      m.initLicense()
      const key = makeJwt({ tier: 'business', email: 'owner@example.com' })
      await m.activateLicenseKey(key)
      expect(m.getLicenseTier()).toBe('business')

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ active: false }), { status: 200 })
      )
      await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000 + 1000)
      expect(m.getLicenseTier()).toBe('free')
    })
  })
})
