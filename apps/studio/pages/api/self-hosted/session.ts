import crypto from 'node:crypto'
import type { NextApiRequest, NextApiResponse } from 'next'

const USERNAME = process.env.DASHBOARD_USERNAME || 'supabase'
const PASSWORD = process.env.DASHBOARD_PASSWORD || ''

const COOKIE_NAME = 'studio_session'
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 // 7 days

function sign(value: string): string {
  const secret = process.env.STUDIO_SESSION_SECRET || PASSWORD || 'studio-session-secret'
  return crypto.createHmac('sha256', secret).update(value).digest('hex')
}

function makeToken(): string {
  const ts = Date.now().toString()
  return `${ts}.${sign(ts)}`
}

function verifyToken(token: string): boolean {
  const [ts, sig] = token.split('.')
  if (!ts || !sig) return false
  const age = Date.now() - parseInt(ts, 10)
  if (isNaN(age) || age > COOKIE_MAX_AGE * 1000) return false
  return sig === sign(ts)
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Let the client know whether authentication is required.
    return res.status(200).json({ required: Boolean(PASSWORD) })
  }

  if (req.method === 'POST') {
    const { username, password } = req.body ?? {}

    if (!PASSWORD) {
      // No password configured — accept any credentials and set a session.
      const token = makeToken()
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`)
      return res.status(200).json({ ok: true })
    }

    if (String(username ?? USERNAME) !== USERNAME || String(password) !== PASSWORD) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = makeToken()
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`)
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
    return res.status(200).json({ ok: true })
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` })
}

export { verifyToken, COOKIE_NAME }
