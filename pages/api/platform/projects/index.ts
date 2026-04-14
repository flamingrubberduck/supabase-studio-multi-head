import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { IS_PLATFORM } from '@/lib/constants'
import { DEFAULT_PROJECT } from '@/lib/constants/api'
import { getAllProjects } from '@/lib/api/self-hosted/project-registry'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGetAll = async (_req: NextApiRequest, res: NextApiResponse) => {
  if (IS_PLATFORM) {
    return res.status(200).json([DEFAULT_PROJECT])
  }

  const registryProjects = getAllProjects().map((p) => ({
    id: p.id,
    ref: p.ref,
    name: p.name,
    organization_id: 1,
    cloud_provider: 'localhost',
    status:
      p.status === 'active'
        ? 'ACTIVE_HEALTHY'
        : p.status === 'creating'
          ? 'COMING_UP'
          : 'INACTIVE',
    region: 'local',
    inserted_at: p.insertedAt,
  }))

  return res.status(200).json([DEFAULT_PROJECT, ...registryProjects])
}
