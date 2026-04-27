import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { provisionStandby, triggerFailover } from '@/lib/api/self-hosted/failoverManager'
import {
  deleteStoredProject,
  getStoredProjectByRef,
  updateProjectFields,
} from '@/lib/api/self-hosted/projectsStore'
import { teardownProjectStack } from '@/lib/api/self-hosted/orchestrator'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ref = req.query.ref as string

  switch (req.method) {
    case 'POST':
      return handleProvision(ref, res)
    case 'DELETE':
      return handleDeprovision(ref, res)
    default:
      res.setHeader('Allow', ['POST', 'DELETE'])
      return res.status(405).json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
  }
}

/**
 * POST /api/platform/projects/{ref}/standby
 *
 * Provisions a warm standby stack for this project. The standby inherits
 * the primary's JWT credentials so tokens remain valid after a failover.
 * Returns immediately; standby transitions COMING_UP → ACTIVE_HEALTHY asynchronously.
 */
async function handleProvision(primaryRef: string, res: NextApiResponse) {
  const project = getStoredProjectByRef(primaryRef)
  if (!project) {
    return res.status(404).json({ data: null, error: { message: 'Project not found' } })
  }
  if (project.role === 'standby') {
    return res.status(400).json({ data: null, error: { message: 'Cannot provision a standby for a standby project' } })
  }
  if (project.standby_ref) {
    return res.status(409).json({
      data: null,
      error: { message: `Project already has a standby (${project.standby_ref})` },
    })
  }

  let standbyRef: string
  try {
    standbyRef = await provisionStandby(primaryRef)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(500).json({ data: null, error: { message } })
  }

  return res.status(202).json({
    standby_ref: standbyRef,
    status: 'COMING_UP',
    message: 'Standby stack is being provisioned. Poll the standby project status to track progress.',
  })
}

/**
 * DELETE /api/platform/projects/{ref}/standby
 *
 * Tears down this project's standby stack and removes the failover pairing.
 */
async function handleDeprovision(primaryRef: string, res: NextApiResponse) {
  const project = getStoredProjectByRef(primaryRef)
  if (!project) {
    return res.status(404).json({ data: null, error: { message: 'Project not found' } })
  }
  if (!project.standby_ref) {
    return res.status(404).json({ data: null, error: { message: 'No standby configured for this project' } })
  }

  const standby = getStoredProjectByRef(project.standby_ref)

  // Clear pairing on primary first
  updateProjectFields(primaryRef, { role: undefined, standby_ref: undefined })

  if (standby) {
    deleteStoredProject(standby.ref)
    if (standby.docker_project) {
      teardownProjectStack(standby.ref, standby.docker_project).catch((err) =>
        console.warn(`[failover] Standby teardown failed for ${standby.ref}:`, err)
      )
    }
  }

  return res.status(200).json({ message: 'Standby deprovisioned' })
}
