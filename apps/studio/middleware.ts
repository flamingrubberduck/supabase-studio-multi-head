import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'studio_session'

// Paths that never require authentication.
const PUBLIC_PREFIXES = [
  '/sign-in',
  '/api/self-hosted/session',
  '/_next',
  '/favicon',
  '/img/',
]

async function verifyToken(token: string, secret: string): Promise<boolean> {
  try {
    const dot = token.indexOf('.')
    if (dot === -1) return false
    const ts = token.slice(0, dot)
    const sig = token.slice(dot + 1)

    const age = Date.now() - parseInt(ts, 10)
    if (isNaN(age) || age > 7 * 24 * 60 * 60 * 1000) return false

    const keyData = new TextEncoder().encode(secret)
    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = hexToBytes(sig)
    const msgBytes = new TextEncoder().encode(ts)
    return await crypto.subtle.verify('HMAC', key, sigBytes.buffer as ArrayBuffer, msgBytes)
  } catch {
    return false
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export async function middleware(req: NextRequest) {
  const isPlatform = process.env.NEXT_PUBLIC_IS_PLATFORM === 'true'
  const dashboardPassword = process.env.DASHBOARD_PASSWORD

  // Cloud deployments and unconfigured self-hosted instances pass through.
  if (isPlatform || !dashboardPassword) return NextResponse.next()

  const { pathname } = req.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()

  const secret = process.env.STUDIO_SESSION_SECRET || dashboardPassword
  const cookieValue = req.cookies.get(COOKIE_NAME)?.value

  if (cookieValue && (await verifyToken(cookieValue, secret))) {
    return NextResponse.next()
  }

  const signInUrl = req.nextUrl.clone()
  signInUrl.pathname = '/sign-in'
  return NextResponse.redirect(signInUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
