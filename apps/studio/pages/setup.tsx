import { useRouter } from 'next/router'
import { useState } from 'react'
import { Button, Input_Shadcn_, Label_Shadcn_ } from 'ui'

import { AuthenticationLayout } from '@/components/layouts/AuthenticationLayout'
import SignInLayout from '@/components/layouts/SignInLayout/SignInLayout'
import { STUDIO_AUTH_GOTRUE } from '@/lib/constants'
import type { NextPageWithLayout } from '@/types'

const SetupPage: NextPageWithLayout = () => {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (!STUDIO_AUTH_GOTRUE) {
    // Not applicable outside GoTrue mode
    if (typeof window !== 'undefined') router.replace('/projects')
    return null
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/self-hosted/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const body = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (res.status === 409) {
          // Already bootstrapped — go to sign-in
          router.replace('/sign-in')
          return
        }
        setError(body.error ?? 'Setup failed')
        return
      }

      router.replace('/sign-in')
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <p className="text-sm text-foreground-light">
        Create the first admin account for this Studio instance.
      </p>

      <div className="flex flex-col gap-1">
        <Label_Shadcn_ htmlFor="setup-email">Email</Label_Shadcn_>
        <Input_Shadcn_
          id="setup-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label_Shadcn_ htmlFor="setup-password">Password</Label_Shadcn_>
        <Input_Shadcn_
          id="setup-password"
          type="password"
          autoComplete="new-password"
          placeholder="Min. 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          required
          minLength={8}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button block type="primary" htmlType="submit" loading={loading} disabled={loading}>
        Create admin account
      </Button>
    </form>
  )
}

SetupPage.getLayout = (page) => (
  <AuthenticationLayout>
    <SignInLayout
      heading="Set up Studio"
      subheading="Create your admin account to get started"
      logoLinkToMarketingSite={false}
    >
      {page}
    </SignInLayout>
  </AuthenticationLayout>
)

export default SetupPage
