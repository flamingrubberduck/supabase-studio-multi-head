import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import {
  createStoredOrganization,
  getStoredOrganizations,
} from '@/lib/api/self-hosted/organizationsStore'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    case 'POST':
      return handleCreate(req, res)
    default:
      res.setHeader('Allow', ['GET', 'POST'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGetAll = async (_req: NextApiRequest, res: NextApiResponse) => {
  return res.status(200).json(getStoredOrganizations())
}

const handleCreate = async (req: NextApiRequest, res: NextApiResponse) => {
  const { name, kind, size, tier } = req.body

  if (!name?.trim()) {
    return res.status(400).json({ data: null, error: { message: 'Organization name is required' } })
  }

  const org = createStoredOrganization({ name: name.trim(), kind, size, tier })
  return res.status(201).json(org)
}
