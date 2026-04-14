import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { post } from '@/data/fetchers'
import { selfHostedProjectKeys } from '@/data/self-hosted-projects/keys'

async function setProjectState(ref: string, action: 'start' | 'stop'): Promise<void> {
  const { error } = await post(`/api/self-hosted/projects/${ref}/${action}` as any, {} as any)
  if (error) throw new Error((error as any).message ?? `Failed to ${action} project`)
}

export function useProjectStartMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ref: string) => setProjectState(ref, 'start'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: selfHostedProjectKeys.list() }),
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useProjectStopMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ref: string) => setProjectState(ref, 'stop'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: selfHostedProjectKeys.list() }),
    onError: (error: Error) => toast.error(error.message),
  })
}
