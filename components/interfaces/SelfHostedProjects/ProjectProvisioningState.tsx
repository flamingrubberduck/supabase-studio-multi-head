import { useRouter } from 'next/router'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from 'ui'
import { Loader2, CheckCircle2, XCircle, Circle } from 'lucide-react'

import { get } from '@/data/fetchers'

type ServiceStatus = 'running' | 'stopped' | 'not found' | 'waiting'

interface ServiceRowProps {
  label: string
  status: ServiceStatus
}

function ServiceRow({ label, status }: ServiceRowProps) {
  return (
    <div className="flex items-center gap-3">
      {status === 'waiting' && <Circle size={16} className="text-foreground-muted shrink-0" />}
      {status === 'running' && (
        <CheckCircle2 size={16} className="text-brand shrink-0" />
      )}
      {status === 'stopped' && (
        <Loader2 size={16} className="text-foreground-light shrink-0 animate-spin" />
      )}
      {status === 'not found' && (
        <XCircle size={16} className="text-destructive shrink-0" />
      )}
      <span
        className={cn(
          'text-sm',
          status === 'running' && 'text-foreground',
          status !== 'running' && 'text-foreground-light'
        )}
      >
        {label}
      </span>
      {status === 'stopped' && (
        <span className="text-xs text-foreground-lighter ml-auto">Starting…</span>
      )}
      {status === 'running' && (
        <span className="text-xs text-brand ml-auto">Ready</span>
      )}
    </div>
  )
}

interface HealthData {
  db: ServiceStatus
  meta: ServiceStatus
  rest: ServiceStatus
  auth: ServiceStatus
  overall: 'healthy' | 'degraded' | 'offline'
}

interface ProjectProvisioningStateProps {
  projectRef: string
}

const SERVICES: Array<{ key: keyof Omit<HealthData, 'overall'>; label: string }> = [
  { key: 'db', label: 'Database (Postgres)' },
  { key: 'meta', label: 'Schema API (pg-meta)' },
  { key: 'rest', label: 'Data API (PostgREST)' },
  { key: 'auth', label: 'Auth (GoTrue)' },
]

export function ProjectProvisioningState({ projectRef }: ProjectProvisioningStateProps) {
  const router = useRouter()

  const { data: health } = useQuery({
    queryKey: ['self-hosted-projects', projectRef, 'health'],
    queryFn: async () => {
      const { data } = await get(
        `/api/self-hosted/projects/${projectRef}/health` as any,
        {} as any
      )
      return data as unknown as HealthData
    },
    refetchInterval: 3_000,
    retry: false,
  })

  useEffect(() => {
    if (health?.overall === 'healthy') {
      // Small delay so user sees all green before redirect
      const t = setTimeout(() => router.reload(), 1500)
      return () => clearTimeout(t)
    }
  }, [health?.overall, router])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <Loader2 size={32} className="text-brand animate-spin" />
        <h2 className="text-lg font-medium">Setting up your project</h2>
        <p className="text-sm text-foreground-light max-w-xs">
          Docker containers are starting. This usually takes 20–40 seconds.
        </p>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-3 rounded-lg border bg-surface-100 p-4">
        {SERVICES.map(({ key, label }) => (
          <ServiceRow
            key={key}
            label={label}
            status={health ? health[key] : 'waiting'}
          />
        ))}
      </div>

      {health?.overall === 'healthy' && (
        <p className="text-sm text-brand">All services ready — redirecting…</p>
      )}
    </div>
  )
}
