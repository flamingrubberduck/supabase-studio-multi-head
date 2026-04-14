import { useQuery, queryOptions } from '@tanstack/react-query'

import { get, handleError } from '@/data/fetchers'
import type { UseCustomQueryOptions } from '@/types'
import { selfHostedProjectKeys } from './keys'

export type SelfHostedProjectHealth = {
  ref: string
  db: 'running' | 'stopped' | 'not found'
  meta: 'running' | 'stopped' | 'not found'
  rest: 'running' | 'stopped' | 'not found'
  auth: 'running' | 'stopped' | 'not found'
  overall: 'healthy' | 'degraded' | 'offline'
}

export type SelfHostedProject = {
  id: number
  ref: string
  name: string
  status: 'creating' | 'active' | 'stopped' | 'error'
  metaUrl: string
  kongUrl: string
  anonKey: string
  serviceRoleKey: string
  insertedAt: string
  ports: { meta: number; kong: number; db: number }
  health: SelfHostedProjectHealth | null
}

async function getSelfHostedProjects(): Promise<SelfHostedProject[]> {
  const { data, error } = await get('/api/self-hosted/projects' as any, {})
  if (error) handleError(error)
  return data as unknown as SelfHostedProject[]
}

export const selfHostedProjectsQueryOptions = queryOptions({
  queryKey: selfHostedProjectKeys.list(),
  queryFn: getSelfHostedProjects,
})

export function useSelfHostedProjectsQuery(
  options: UseCustomQueryOptions<SelfHostedProject[]> = {}
) {
  return useQuery({
    ...selfHostedProjectsQueryOptions,
    ...options,
  })
}
