import { createClient } from '@supabase/supabase-js'
import { NextApiRequest, NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { getProjectAuthConfig } from '@/lib/api/self-hosted/util'

export default (req: NextApiRequest, res: NextApiResponse) => apiWrapper(req, res, handler)

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'DELETE':
      return handleDelete(req, res)
    default:
      res.setHeader('Allow', ['DELETE'])
      res.status(405).json({ data: null, error: { message: `Method ${method} Not Allowed` } })
  }
}

const handleDelete = async (req: NextApiRequest, res: NextApiResponse) => {
  const { ref, id } = req.query as { ref: string; id: string }
  const { url, serviceKey } = getProjectAuthConfig(ref)
  const supabase = createClient(url, serviceKey)

  const { data: factors, error } = await supabase.auth.admin.mfa.listFactors({ userId: id })
  if (error) return res.status(400).json({ error: { message: error.message } })

  for (const factor of factors?.factors ?? []) {
    const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: id,
    })
    if (deleteError) return res.status(400).json({ error: { message: deleteError.message } })
  }

  return res.status(200).json({ data: null, error: null })
}
