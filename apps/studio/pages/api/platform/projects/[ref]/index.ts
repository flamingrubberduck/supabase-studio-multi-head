import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { teardownProjectStack } from '@/lib/api/self-hosted/orchestrator'
import { deleteStoredProject, getStoredProjectByRef } from '@/lib/api/self-hosted/projectsStore'
import { PROJECT_REST_URL } from '@/lib/constants/api'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      res.setHeader('Allow', ['GET', 'DELETE'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGet = async (req: NextApiRequest, res: NextApiResponse) => {
  const ref = req.query.ref as string
  const project = getStoredProjectByRef(ref)

  if (!project) {
    return res.status(404).json({ data: null, error: { message: 'Project not found' } })
  }

  // Strip sensitive fields before returning
  const { db_password, anon_key, service_key, jwt_secret, ...safeProject } = project

  return res.status(200).json({
    ...safeProject,
    connectionString: '',
    restUrl: PROJECT_REST_URL,
  })
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const ref = req.query.ref as string
  const project = getStoredProjectByRef(ref)

  if (!project) {
    return res.status(404).json({ data: null, error: { message: 'Project not found' } })
  }

  if (ref === 'default') {
    return res
      .status(400)
      .json({ data: null, error: { message: 'The default project cannot be deleted.' } })
  }

  // Remove from store immediately so the UI reflects deletion
  deleteStoredProject(ref)

  // Tear down the Docker stack in the background — don't block the response
  if (project.docker_project) {
    teardownProjectStack(ref, project.docker_project, project.docker_host).catch((err: unknown) => {
      console.error(
        `[multi-head] Stack teardown failed for ${ref}: ${err instanceof Error ? err.message : err}`
      )
    })
  }

  return res.status(200).json({ ref, name: project.name })
}
