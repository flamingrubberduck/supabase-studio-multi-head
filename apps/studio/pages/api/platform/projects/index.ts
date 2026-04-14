import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import {
  createStoredProject,
  getStoredProjects,
  updateProjectStatus,
  updateStoredProjectField,
} from '@/lib/api/self-hosted/projectsStore'
import {
  allocateNextPorts,
  discoverDockerStackPorts,
  generateProjectCredentials,
  launchProjectStack,
  waitForProjectHealth,
} from '@/lib/api/self-hosted/orchestrator'

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
  const projects = getStoredProjects()
  // Strip sensitive fields from the list response
  return res.status(200).json(
    projects.map(({ db_password, anon_key, service_key, jwt_secret, ...rest }) => rest)
  )
}

const handleCreate = async (req: NextApiRequest, res: NextApiResponse) => {
  const { name } = req.body

  if (!name?.trim()) {
    return res.status(400).json({ data: null, error: { message: 'Project name is required' } })
  }

  if (!process.env.PG_META_CRYPTO_KEY) {
    return res.status(400).json({
      data: null,
      error: {
        message:
          'PG_META_CRYPTO_KEY is not configured. ' +
          'Add it to your Studio .env file and ensure it matches the CRYPTO_KEY in your pg-meta service.',
      },
    })
  }

  // Collect ports already used by stored projects (skip legacy projects without kong_http_port)
  // plus any live Docker stacks discovered via the Docker daemon.
  const storedKongPorts = getStoredProjects()
    .map((p) => p.kong_http_port)
    .filter((p): p is number => p !== undefined)
  const dockerKongPorts = discoverDockerStackPorts()
  const usedPorts = [...new Set([...storedKongPorts, ...dockerKongPorts])]

  const ports = allocateNextPorts(usedPorts)
  const credentials = generateProjectCredentials()
  const multiHeadHost = process.env.MULTI_HEAD_HOST || 'localhost'
  const publicUrl = `http://${multiHeadHost}:${ports.kongHttpPort}`

  // Persist the record immediately with COMING_UP so the UI can show progress
  const project = createStoredProject({
    name: name.trim(),
    public_url: publicUrl,
    postgres_port: ports.postgresPort,
    kong_http_port: ports.kongHttpPort,
    pooler_port: ports.poolerPort,
    pooler_tenant_id: credentials.poolerTenantId,
    docker_project: `supabase-placeholder`, // overwritten below
    db_password: credentials.postgresPassword,
    anon_key: credentials.anonKey,
    service_key: credentials.serviceKey,
    jwt_secret: credentials.jwtSecret,
    status: 'COMING_UP',
  })

  // Now we know the ref; set the real docker_project name
  const dockerProject = `supabase-${project.ref}`
  updateStoredProjectField(project.ref, 'docker_project', dockerProject)

  // Launch the Docker Compose stack in the background; the caller gets the
  // project record immediately (status=COMING_UP) and can poll for status.
  launchProjectStack({
    ref: project.ref,
    name: name.trim(),
    ports,
    credentials,
  })
    .then(() => waitForProjectHealth(publicUrl))
    .then(() => updateProjectStatus(project.ref, 'ACTIVE_HEALTHY'))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[multi-head] Stack launch failed for ${project.ref}: ${msg}`)
      updateProjectStatus(project.ref, 'INACTIVE')
    })

  return res.status(201).json({
    id: project.id,
    ref: project.ref,
    name: project.name,
    organization_id: project.organization_id,
    organization_slug: 'default-org-slug',
    cloud_provider: project.cloud_provider,
    status: 'COMING_UP',
    region: project.region,
    inserted_at: project.inserted_at,
  })
}
