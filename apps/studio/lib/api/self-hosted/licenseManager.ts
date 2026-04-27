import crypto from 'node:crypto'

export type LicenseTier = 'free' | 'pro'

// ── In-process state ─────────────────────────────────────────────────────────

let currentTier: LicenseTier = 'free'
let graceDeadline = 0          // epoch ms — 0 means no grace active
let inGrace = false            // true while server is unreachable but grace hasn't expired

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000  // 7 days
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000       // re-check every 6 hours

// ── JWT helpers (no external dependency) ─────────────────────────────────────

function base64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
}

interface LicensePayload {
  tier?: string
  email?: string
  issued_to?: string
  iat?: number
}

/**
 * Verifies an HS256 JWT against secret and returns the decoded payload,
 * or null if the signature is invalid or the token is malformed.
 */
function verifyJwt(token: string, secret: string): LicensePayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, payload, sig] = parts
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url')
    if (expected !== sig) return null
    return JSON.parse(base64urlDecode(payload)) as LicensePayload
  } catch {
    return null
  }
}

// ── License server check ─────────────────────────────────────────────────────

async function checkLicenseServer(): Promise<void> {
  const key = process.env.MULTI_HEAD_LICENSE_KEY
  const serverUrl = process.env.MULTI_HEAD_LICENSE_SERVER_URL
  if (!key || !serverUrl) return

  try {
    const res = await fetch(
      `${serverUrl.replace(/\/$/, '')}/v1/validate?key=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(10_000) }
    )

    if (!res.ok) {
      console.warn(`[license] Server returned HTTP ${res.status} — treating as unreachable`)
      applyUnreachable()
      return
    }

    const body = await res.json() as { active?: boolean }

    if (body.active === true) {
      currentTier = 'pro'
      graceDeadline = Date.now() + GRACE_PERIOD_MS
      inGrace = false
      console.log('[license] Pro license confirmed by server.')
    } else {
      currentTier = 'free'
      graceDeadline = 0
      inGrace = false
      console.warn('[license] License revoked by server — downgrading to Free tier.')
    }
  } catch {
    applyUnreachable()
  }
}

function applyUnreachable(): void {
  if (graceDeadline > 0 && Date.now() < graceDeadline) {
    // Still within grace — keep current tier
    inGrace = true
    const daysLeft = Math.ceil((graceDeadline - Date.now()) / (24 * 60 * 60 * 1000))
    console.warn(`[license] License server unreachable — grace period active (${daysLeft}d remaining). Keeping ${currentTier} tier.`)
  } else {
    inGrace = false
    if (currentTier === 'pro') {
      currentTier = 'free'
      console.warn('[license] License server unreachable and grace period expired — downgrading to Free tier.')
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getLicenseTier(): LicenseTier {
  return currentTier
}

export function getLicenseStatus(): { tier: LicenseTier; grace: boolean } {
  return { tier: currentTier, grace: inGrace }
}

/** Returns { ok: true } for pro tier, { ok: false, message } for free tier. */
export function requirePro(): { ok: boolean; message?: string } {
  if (currentTier === 'pro') return { ok: true }
  return {
    ok: false,
    message:
      'This feature requires a Pro license. Set MULTI_HEAD_LICENSE_KEY in your .env and restart Studio.',
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __licenseInitialized: boolean | undefined
}

/**
 * Called once from instrumentation.ts on server start.
 * Validates the key locally, then kicks off a background server check
 * and schedules re-checks every 6 hours.
 */
export function initLicense(): void {
  if (globalThis.__licenseInitialized) return
  globalThis.__licenseInitialized = true

  const key = process.env.MULTI_HEAD_LICENSE_KEY
  const secret = process.env.MULTI_HEAD_LICENSE_SECRET

  if (!key) {
    console.log('[license] No MULTI_HEAD_LICENSE_KEY — running as Free tier.')
    return
  }

  if (!secret) {
    console.warn('[license] MULTI_HEAD_LICENSE_SECRET not set — cannot verify key. Running as Free tier.')
    return
  }

  const payload = verifyJwt(key, secret)
  if (!payload) {
    console.warn('[license] License key signature invalid — running as Free tier.')
    return
  }

  if (payload.tier !== 'pro') {
    console.log(`[license] License tier: ${payload.tier ?? 'unknown'}. Running as Free tier.`)
    return
  }

  // Signature valid and tier is pro — optimistically set pro, then confirm with server
  currentTier = 'pro'
  console.log(`[license] License key valid (issued to: ${payload.email ?? payload.issued_to ?? 'unknown'}). Confirming with server...`)

  // First check immediately in background, then every 6 hours
  checkLicenseServer().catch(console.error)
  setInterval(() => checkLicenseServer().catch(console.error), CHECK_INTERVAL_MS)
}
