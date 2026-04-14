import type { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { deleteProject } from '@/lib/api/self-hosted/project-orchestrator'
import { getProject } from '@/lib/api/self-hosted/project-registry'
import { assertSelfHosted } from '@/lib/api/self-hosted/util'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  assertSelfHosted()
  const { ref } = req.query as { ref: string }

  switch (req.method) {
    case 'GET':
      return handleGet(ref, res)
    case 'DELETE':
      return handleDelete(ref, res)
    default:
      res.setHeader('Allow', ['GET', 'DELETE'])
      return res.status(405).json({ error: { message: `Method ${req.method} Not Allowed` } })
  }
}

const handleGet = (ref: string, res: NextApiResponse) => {
  const project = getProject(ref)
  if (!project) return res.status(404).json({ error: { message: 'Project not found' } })
  return res.status(200).json(project)
}

const handleDelete = async (ref: string, res: NextApiResponse) => {
  const project = getProject(ref)
  if (!project) return res.status(404).json({ error: { message: 'Project not found' } })

  try {
    await deleteProject(ref)
    return res.status(200).json({ message: 'Project deleted' })
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message } })
  }
}
