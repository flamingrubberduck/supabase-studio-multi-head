import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { handleError, post } from '@/data/fetchers'
import { selfHostedProjectKeys } from './keys'
import type { SelfHostedProject } from './self-hosted-projects-query'

async function createSelfHostedProject(name: string): Promise<SelfHostedProject> {
  const { data, error } = await post('/api/self-hosted/projects' as any, { body: { name } } as any)
  if (error) handleError(error)
  return data as unknown as SelfHostedProject
}

export function useSelfHostedProjectCreateMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => createSelfHostedProject(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: selfHostedProjectKeys.list() })
    },
    onError: (error: Error) => {
      toast.error(`Failed to create project: ${error.message}`)
    },
  })
}
