import type { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { stopProject } from '@/lib/api/self-hosted/project-orchestrator'
import { getProject } from '@/lib/api/self-hosted/project-registry'
import { assertSelfHosted } from '@/lib/api/self-hosted/util'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  assertSelfHosted()
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: { message: `Method ${req.method} Not Allowed` } })
  }

  const { ref } = req.query as { ref: string }
  if (!getProject(ref)) return res.status(404).json({ error: { message: 'Project not found' } })

  try {
    await stopProject(ref)
    return res.status(200).json({ message: 'Project stopped' })
  } catch (err: any) {
    return res.status(500).json({ error: { message: err.message } })
  }
}
