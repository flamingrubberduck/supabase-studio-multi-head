import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { getStoredProjects } from '@/lib/api/self-hosted/projectsStore'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'GET':
      return handleGetAll(req, res)
    default:
      res.setHeader('Allow', ['GET'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleGetAll = async (req: NextApiRequest, res: NextApiResponse) => {
  const { slug } = req.query
  const { search, limit = '96', offset = '0' } = req.query

  let projects = getStoredProjects().filter(
    (p) => p.organization_slug === slug
  )

  if (search && typeof search === 'string' && search.length > 0) {
    const q = search.toLowerCase()
    projects = projects.filter((p) => p.name.toLowerCase().includes(q))
  }

  const total = projects.length
  const pageLimit = Number(limit)
  const pageOffset = Number(offset)
  const paged = projects.slice(pageOffset, pageOffset + pageLimit)

  return res.status(200).json({
    pagination: {
      count: total,
      limit: pageLimit,
      offset: pageOffset,
    },
    projects: paged.map((p) => ({
      ref: p.ref,
      name: p.name,
      cloud_provider: p.cloud_provider,
      region: p.region,
      status: p.status,
      inserted_at: p.inserted_at,
      public_url: p.public_url,
      kong_http_port: p.kong_http_port,
      is_branch: false,
      databases: [
        {
          identifier: p.ref,
          cloud_provider: p.cloud_provider,
          region: p.region,
          status: p.status,
          type: 'PRIMARY',
        },
      ],
    })),
  })
}
