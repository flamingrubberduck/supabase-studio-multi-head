import { NextApiRequest, NextApiResponse } from 'next'

import {
  getLicenseStatus,
  activateLicenseKey,
  deactivateLicense,
} from '@/lib/api/self-hosted/licenseManager'

/**
 * GET  /api/self-hosted/license  — current tier + grace state
 * POST /api/self-hosted/license  — activate a license key  { key: string }
 * DELETE /api/self-hosted/license — deactivate (revert to Free)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET': {
      const status = getLicenseStatus()
      return res.status(200).json(status)
    }

    case 'POST': {
      const key = req.body?.key
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: { message: 'key is required' } })
      }
      try {
        const email = await activateLicenseKey(key)
        const status = getLicenseStatus()
        return res.status(200).json({
          message: `License activated — ${status.tier} tier`,
          tier: status.tier,
          email: email ?? undefined,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return res.status(422).json({ error: { message } })
      }
    }

    case 'DELETE': {
      deactivateLicense()
      return res.status(200).json({ message: 'License deactivated — running as Free tier' })
    }

    default:
      res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
      return res.status(405).json({ error: { message: `Method ${req.method} Not Allowed` } })
  }
}
