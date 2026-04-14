import type { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { isDockerAvailable } from '@/lib/api/self-hosted/docker-client'
import { createProject, getAllProjectsHealth } from '@/lib/api/self-hosted/project-orchestrator'
import { getAllProjects } from '@/lib/api/self-hosted/project-registry'
import { assertSelfHosted } from '@/lib/api/self-hosted/util'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  assertSelfHosted()

  switch (req.method) {
    case 'GET':
      return handleGet(req, res)
    case 'POST':
      return handlePost(req, res)
    default:
      res.setHeader('Allow', ['GET', 'POST'])
      return res.status(405).json({ error: { message: `Method ${req.method} Not Allowed` } })
  }
}

const handleGet = async (_req: NextApiRequest, res: NextApiResponse) => {
  const projects = getAllProjects()
  const healths = await getAllProjectsHealth().catch(() => [])
  const healthMap = Object.fromEntries(healths.map((h) => [h.ref, h]))

  const response = projects.map((p) => ({
    ...p,
    health: healthMap[p.ref] ?? null,
  }))

  return res.status(200).json(response)
}

const handlePost = async (req: NextApiRequest, res: NextApiResponse) => {
  const { name } = req.body as { name?: string }
  if (!name || name.trim().length < 3) {
    return res.status(400).json({ error: { message: 'Project name must be at least 3 characters' } })
  }

  const available = await isDockerAvailable()
  if (!available) {
    return res.status(503).json({
      error: {
        message:
          'Docker socket not accessible. Mount the Docker socket and set DOCKER_SOCKET_LOCATION in your studio environment.',
      },
    })
  }

  try {
    const project = await createProject(name.trim())
    return res.status(201).json(project)
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message } })
  }
}
