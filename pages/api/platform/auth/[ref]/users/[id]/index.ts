import { createClient } from '@supabase/supabase-js'
import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { getProjectAuthConfig } from '@/lib/api/self-hosted/util'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'PATCH':
      return handlePatch(req, res)
    case 'DELETE':
      return handleDelete(req, res)
    default:
      res.setHeader('Allow', ['PATCH'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handlePatch = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref, id } = req.query as { ref: string; id: string }
  const { url, serviceKey } = getProjectAuthConfig(ref)
  const supabase = createClient(url, serviceKey)
  const { ban_duration } = req.body
  const { data, error } = await supabase.auth.admin.updateUserById(id, { ban_duration })

  if (error) return res.status(400).json({ error: { message: error.message } })
  return res.status(200).json(data.user)
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref, id } = req.query as { ref: string; id: string }
  const { url, serviceKey } = getProjectAuthConfig(ref)
  const supabase = createClient(url, serviceKey)
  const { data, error } = await supabase.auth.admin.deleteUser(id)

  if (error) return res.status(400).json({ error: { message: error.message } })
  return res.status(200).json(data)
}
