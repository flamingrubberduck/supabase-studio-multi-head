import type { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { getProjectHealth } from '@/lib/api/self-hosted/project-orchestrator'
import { getProject } from '@/lib/api/self-hosted/project-registry'
import { assertSelfHosted } from '@/lib/api/self-hosted/util'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  assertSelfHosted()
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).json({ error: { message: `Method ${req.method} Not Allowed` } })
  }

  const { ref } = req.query as { ref: string }
  if (!getProject(ref)) return res.status(404).json({ error: { message: 'Project not found' } })

  try {
    const health = await getProjectHealth(ref)
    const statusCode = health.overall === 'healthy' ? 200 : health.overall === 'offline' ? 503 : 206
    return res.status(statusCode).json(health)
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message } })
  }
}
