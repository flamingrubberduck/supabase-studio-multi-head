import { zodResolver } from '@hookform/resolvers/zod'
import { ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button, Form_Shadcn_, FormControl_Shadcn_, FormField_Shadcn_, Switch } from 'ui'
import { Input } from 'ui-patterns/DataInputs/Input'
import { FormItemLayout } from 'ui-patterns/form/FormItemLayout/FormItemLayout'
import { z } from 'zod'

import Panel from '@/components/ui/Panel'
import { useProjectCreateMutation } from '@/data/projects/project-create-mutation'
import { useSelectedOrganizationQuery } from '@/hooks/misc/useSelectedOrganization'

const schema = z.object({
  projectName: z
    .string()
    .trim()
    .min(3, 'Project name must be at least 3 characters')
    .max(64, 'Project name must be no longer than 64 characters'),
})

type FormValues = z.infer<typeof schema>

export function SelfHostedProjectCreation() {
  const router = useRouter()
  const { data: currentOrg } = useSelectedOrganizationQuery()
  const [withStandby, setWithStandby] = useState(false)
  const [isProvisioningStandby, setIsProvisioningStandby] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { projectName: '' },
  })

  const { mutateAsync: createProjectAsync, isPending: isCreating } = useProjectCreateMutation()
  const isPending = isCreating || isProvisioningStandby

  const onSubmit = async ({ projectName }: FormValues) => {
    if (!currentOrg) return toast.error('No organization selected')

    let project: { ref: string } | undefined
    try {
      project = await createProjectAsync({
        name: projectName,
        organizationSlug: currentOrg.slug,
        dbPass: '',
      })
    } catch (err) {
      toast.error(`Failed to create project: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    if (!project) return

    if (withStandby) {
      setIsProvisioningStandby(true)
      try {
        const res = await fetch(`/api/platform/projects/${project.ref}/standby`, { method: 'POST' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch {
        toast.warning('Project created — standby could not be provisioned. Add it from Settings › General.')
      } finally {
        setIsProvisioningStandby(false)
      }
    }

    router.push(`/project/${project.ref}`)
  }

  return (
    <Form_Shadcn_ {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Panel
          title={
            <div>
              <h3>Create a new project</h3>
              <p className="text-sm text-foreground-lighter">
                A new isolated Supabase stack will be launched automatically. Ports and credentials
                are generated for you.
              </p>
            </div>
          }
          footer={
            <div className="flex items-center justify-end gap-2 p-4">
              <Button type="default" onClick={() => router.back()} disabled={isPending}>
                Cancel
              </Button>
              <Button htmlType="submit" loading={isPending} disabled={isPending}>
                {isProvisioningStandby
                  ? 'Provisioning standby...'
                  : isCreating
                    ? 'Launching stack...'
                    : 'Create project'}
              </Button>
            </div>
          }
        >
          <Panel.Content className="space-y-4">
            <FormField_Shadcn_
              control={form.control}
              name="projectName"
              render={({ field }) => (
                <FormItemLayout
                  label="Project name"
                  layout="horizontal"
                  description="A short, memorable name for this Supabase project."
                >
                  <FormControl_Shadcn_>
                    <Input placeholder="My Project" {...field} />
                  </FormControl_Shadcn_>
                </FormItemLayout>
              )}
            />

            <FormItemLayout
              label={
                <span className="flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-foreground-light" />
                  Launch with failover standby
                </span>
              }
              layout="horizontal"
              description="A warm standby stack will be provisioned automatically. Studio will fail over in ~90 s if the primary becomes unavailable."
            >
              <Switch
                checked={withStandby}
                onCheckedChange={setWithStandby}
                disabled={isPending}
              />
            </FormItemLayout>
          </Panel.Content>
        </Panel>
      </form>
    </Form_Shadcn_>
  )
}
