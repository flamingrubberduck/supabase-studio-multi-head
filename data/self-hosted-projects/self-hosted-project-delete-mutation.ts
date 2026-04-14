import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { del, handleError } from '@/data/fetchers'
import { selfHostedProjectKeys } from './keys'

async function deleteSelfHostedProject(ref: string): Promise<void> {
  const { error } = await del(`/api/self-hosted/projects/${ref}` as any, {} as any)
  if (error) handleError(error)
}

export function useSelfHostedProjectDeleteMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (ref: string) => deleteSelfHostedProject(ref),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: selfHostedProjectKeys.list() })
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete project: ${error.message}`)
    },
  })
}
