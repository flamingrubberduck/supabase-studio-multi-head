import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { addOrgMember } from '@/lib/api/self-hosted/membersStore'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { slug } = req.query as { slug: string }

  if (req.method === 'GET') {
    // Self-hosted: invitations are applied immediately as members, no pending state
    return res.status(200).json({ invitations: [] })
  }

  if (req.method === 'POST') {
    const { email, role_id } = req.body as { email: string; role_id: number }

    if (!email || typeof role_id !== 'number') {
      return res.status(400).json({ data: null, error: { message: 'email and role_id are required' } })
    }

    // In self-hosted mode there is no email delivery, so we add the member directly
    const member = addOrgMember(slug, { primary_email: email, role_id })
    return res.status(200).json(member)
  }

  res.setHeader('Allow', ['GET', 'POST'])
  res.status(405).json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
}
