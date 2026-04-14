import { paths } from 'api-types'
import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { getStoredProjectByRef } from '@/lib/api/self-hosted/projectsStore'

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

type ResponseData =
  paths['/platform/projects/{ref}/config/supavisor']['get']['responses']['200']['content']['application/json']

const handleGet = async (req: NextApiRequest, res: NextApiResponse<ResponseData>) => {
  const ref = req.query.ref as string
  const project = getStoredProjectByRef(ref)

  if (!project) {
    return res.status(200).json([])
  }

  // Derive pooler port from stored value, or fall back to deriving from kong_http_port
  // using the same PORT_INCREMENT (10) the orchestrator uses.
  const defaultKongPort = parseInt(process.env.KONG_HTTP_PORT || '8000', 10)
  const defaultPoolerPort = parseInt(process.env.POOLER_PROXY_PORT_TRANSACTION || '6543', 10)
  const kongPort = project.kong_http_port ?? defaultKongPort
  const poolerPort =
    project.pooler_port ?? defaultPoolerPort + (kongPort - defaultKongPort)

  const tenantId = project.pooler_tenant_id ?? ''
  const poolerUser = tenantId ? `postgres.${tenantId}` : 'postgres'

  // Derive the pooler host from the project's public_url
  let host = process.env.MULTI_HEAD_HOST || 'localhost'
  try {
    host = new URL(project.public_url).hostname
  } catch {
    // fall back to default
  }

  const connectionString = `postgresql://${poolerUser}:[YOUR-PASSWORD]@${host}:${poolerPort}/postgres`

  return res.status(200).json([
    {
      connection_string: connectionString,
      connectionString: connectionString,
      database_type: 'PRIMARY' as const,
      db_host: host,
      db_name: 'postgres',
      db_port: poolerPort,
      db_user: poolerUser,
      default_pool_size: 15,
      identifier: ref,
      is_using_scram_auth: false,
      max_client_conn: 200,
      pool_mode: 'transaction' as const,
    },
  ])
}
