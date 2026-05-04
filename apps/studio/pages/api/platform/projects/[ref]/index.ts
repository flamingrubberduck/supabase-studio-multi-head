import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { teardownProjectStack } from '@/lib/api/self-hosted/orchestrator'
import { dropReplicationSlot } from '@/lib/api/self-hosted/replicationManager'
import { deleteStoredProject, getStoredProjectByRef, getStoredProjects, updateProjectFields } from '@/lib/api/self-hosted/projectsStore'
import { PROJECT_REST_URL } from '@/lib/constants/api'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGet(req, res)
    case 'PATCH':
      return handlePatch(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      res.setHeader('Allow', ['GET', 'PATCH', 'DELETE'])
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

  // Embed replica list when this project is a cluster master
  const clusterId = project.cluster_id
  const replicas =
    clusterId
      ? getStoredProjects()
          .filter((p) => p.cluster_id === clusterId && p.role === 'replica')
          .map(({ db_password: _pw, anon_key: _ak, service_key: _sk, jwt_secret: _js, ...r }) => r)
      : undefined

  return res.status(200).json({
    ...safeProject,
    ...(replicas !== undefined && { replicas }),
    connectionString: '',
    restUrl: PROJECT_REST_URL,
  })
}

const handlePatch = async (req: NextApiRequest, res: NextApiResponse) => {
  const ref = req.query.ref as string
  const { name } = req.body

  if (!name?.trim()) {
    return res.status(400).json({ data: null, error: { message: 'Project name cannot be empty.' } })
  }

  const project = getStoredProjectByRef(ref)
  if (!project) {
    return res.status(404).json({ data: null, error: { message: 'Project not found' } })
  }

  updateProjectFields(ref, { name: String(name).trim() })
  return res.status(200).json({ ...project, name: String(name).trim() })
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

  // Cascade: tear down standby and all replicas that belong to this project's cluster
  const allProjects = getStoredProjects()

  // Standby
  if (project.standby_ref) {
    const standby = allProjects.find((p) => p.ref === project.standby_ref)
    if (standby) {
      dropReplicationSlot(ref, standby.ref)
      deleteStoredProject(standby.ref)
      if (standby.docker_project) {
        teardownProjectStack(standby.ref, standby.docker_project, standby.docker_host).catch(() => {})
      }
    }
  }

  // Cluster replicas (cluster_id === ref of the master being deleted)
  const clusterId = project.cluster_id
  if (clusterId) {
    const replicas = allProjects.filter((p) => p.cluster_id === clusterId && p.role === 'replica')
    for (const replica of replicas) {
      dropReplicationSlot(ref, replica.ref)
      deleteStoredProject(replica.ref)
      if (replica.docker_project) {
        teardownProjectStack(replica.ref, replica.docker_project, replica.docker_host).catch(() => {})
      }
    }
  }

  // Remove the project itself
  deleteStoredProject(ref)

  // Tear down the project's own Docker stack in the background
  if (project.docker_project) {
    teardownProjectStack(ref, project.docker_project, project.docker_host).catch((err: unknown) => {
      console.error(
        `[multi-head] Stack teardown failed for ${ref}: ${err instanceof Error ? err.message : err}`
      )
    })
  }

  return res.status(200).json({ ref, name: project.name })
}
