import type { NextApiRequest, NextApiResponse } from 'next'

import { COOKIE_NAME, verifyToken, decodeSessionPayload } from './session'
import { findMemberByGotrueId } from '@/lib/api/self-hosted/membersStore'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = req.cookies[COOKIE_NAME]
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const payload = decodeSessionPayload(token)

  // No member identity in token → global admin session
  if (!payload?.gotrue_id) {
    return res.status(200).json({ role_id: 1, is_admin_session: true })
  }

  const found = findMemberByGotrueId(payload.gotrue_id)
  if (!found) {
    return res.status(401).json({ error: 'Member not found' })
  }

  const { member, org_slug } = found
  return res.status(200).json({
    gotrue_id: member.gotrue_id,
    email: member.primary_email,
    username: member.username,
    role_id: member.role_ids[0] ?? 1,
    org_slug,
  })
}
