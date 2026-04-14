import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { getProject } from '@/lib/api/self-hosted/project-registry'
import { IS_PLATFORM } from '@/lib/constants'
import { DEFAULT_PROJECT, PROJECT_REST_URL } from '@/lib/constants/api'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref } = req.query as { ref: string }

  if (!IS_PLATFORM && ref && ref !== 'default') {
    const project = getProject(ref)
    if (!project) return res.status(404).json({ error: { message: 'Project not found' } })

    return res.status(200).json({
      id: project.id,
      ref: project.ref,
      name: project.name,
      organization_id: 1,
      cloud_provider: 'localhost',
      status:
        project.status === 'active'
          ? 'ACTIVE_HEALTHY'
          : project.status === 'creating'
            ? 'COMING_UP'
            : 'INACTIVE',
      region: 'local',
      inserted_at: project.insertedAt,
      connectionString: '',
      restUrl: project.restUrl,
    })
  }

  return res.status(200).json({
    ...DEFAULT_PROJECT,
    connectionString: '',
    restUrl: PROJECT_REST_URL,
  })
}
