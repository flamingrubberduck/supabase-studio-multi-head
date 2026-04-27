import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import {
  createStoredProject,
  getStoredProjects,
  updateProjectFields,
  updateProjectStatus,
  updateStoredProjectField,
} from '@/lib/api/self-hosted/projectsStore'
import {
  allocateNextPorts,
  discoverDockerStackPorts,
  extractDockerHostname,
  generateProjectCredentials,
  launchProjectStack,
  waitForProjectHealth,
} from '@/lib/api/self-hosted/orchestrator'
import { provisionReplica } from '@/lib/api/self-hosted/clusterManager'

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

const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  const { limit = '100', offset = '0', search } = req.query

  // Standbys and replicas are internal implementation details — hide them from the project list
  let projects = getStoredProjects().filter((p) => p.role !== 'standby' && p.role !== 'replica')

  if (search && typeof search === 'string' && search.length > 0) {
    const q = search.toLowerCase()
    projects = projects.filter((p) => p.name.toLowerCase().includes(q))
  }

  const total = projects.length
  const pageLimit = Number(limit)
  const pageOffset = Number(offset)
  const paged = projects.slice(pageOffset, pageOffset + pageLimit)

  // Return paginated format expected by useProjectsInfiniteQuery (ListProjectsPaginatedResponse)
  return res.status(200).json({
    pagination: { count: total, limit: pageLimit, offset: pageOffset },
    projects: paged.map(({ db_password, anon_key, service_key, jwt_secret, ...rest }) => rest),
  })
}

const handleCreate = async (req: NextApiRequest, res: NextApiResponse) => {
  const { name, organization_slug, docker_host, cluster_mode } = req.body

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

  const hostname = extractDockerHostname(docker_host ?? undefined)
  const publicUrl = `http://${hostname}:${ports.kongHttpPort}`

  // Persist the record immediately with COMING_UP so the UI can show progress
  const project = createStoredProject({
    name: name.trim(),
    organization_slug: organization_slug ?? 'default-org-slug',
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
    ...(docker_host && typeof docker_host === 'string' && { docker_host }),
  })

  // Now we know the ref; set the real docker_project name
  const dockerProject = `supabase-${project.ref}`
  updateStoredProjectField(project.ref, 'docker_project', dockerProject)

  // Launch the Docker Compose stack in the background; the caller gets the
  // project record immediately (status=COMING_UP) and can poll for status.
  const dockerHostVal = docker_host && typeof docker_host === 'string' ? docker_host : undefined
  launchProjectStack({
    ref: project.ref,
    name: name.trim(),
    ports,
    credentials,
    ...(dockerHostVal && { docker_host: dockerHostVal }),
  })
    .then(() => waitForProjectHealth(publicUrl))
    .then(() => updateProjectStatus(project.ref, 'ACTIVE_HEALTHY'))
    .then(() => {
      if (cluster_mode) {
        // Mark master as cluster head and provision the first replica
        updateProjectFields(project.ref, { cluster_id: project.ref })
        provisionReplica(project.ref, dockerHostVal).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[cluster] Initial replica provision failed for ${project.ref}: ${msg}`)
        })
      }
    })
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
    organization_slug: project.organization_slug,
    cloud_provider: project.cloud_provider,
    status: 'COMING_UP',
    region: project.region,
    inserted_at: project.inserted_at,
  })
}
