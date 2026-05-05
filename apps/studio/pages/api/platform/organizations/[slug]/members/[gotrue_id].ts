import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { assignOrgMemberRole, deleteOrgMember } from '@/lib/api/self-hosted/membersStore'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { slug, gotrue_id } = req.query as { slug: string; gotrue_id: string }

  if (req.method === 'DELETE') {
    const removed = deleteOrgMember(slug, gotrue_id)
    if (!removed) return res.status(404).json({ data: null, error: { message: 'Member not found' } })
    return res.status(200).json({ message: 'Member removed' })
  }

  if (req.method === 'PATCH') {
    const { role_id } = req.body as { role_id: number }
    if (typeof role_id !== 'number') {
      return res.status(400).json({ data: null, error: { message: 'role_id is required' } })
    }
    const updated = assignOrgMemberRole(slug, gotrue_id, role_id)
    if (!updated) return res.status(404).json({ data: null, error: { message: 'Member not found' } })
    return res.status(200).json(updated)
  }

  res.setHeader('Allow', ['DELETE', 'PATCH'])
  res.status(405).json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
}
