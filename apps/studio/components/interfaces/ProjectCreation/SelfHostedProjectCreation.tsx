import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, ChevronUp, Database, Server, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button, Form_Shadcn_, FormControl_Shadcn_, FormField_Shadcn_ } from 'ui'
import { Input } from 'ui-patterns/DataInputs/Input'
import { FormItemLayout } from 'ui-patterns/form/FormItemLayout/FormItemLayout'
import { z } from 'zod'

import Panel from '@/components/ui/Panel'
import { useProjectCreateMutation } from '@/data/projects/project-create-mutation'
import { useSelectedOrganizationQuery } from '@/hooks/misc/useSelectedOrganization'

type DeployMode = 'standalone' | 'standby' | 'cluster'

const schema = z.object({
  projectName: z
    .string()
    .trim()
    .min(3, 'Project name must be at least 3 characters')
    .max(64, 'Project name must be no longer than 64 characters'),
  dockerHost: z
    .string()
    .trim()
    .refine(
      (v) => {
        if (!v) return true
        try {
          const url = new URL(v)
          return url.protocol === 'ssh:' || url.protocol === 'tcp:'
        } catch {
          return false
        }
      },
      { message: 'Must be a valid Docker host URL (e.g. ssh://user@host or tcp://host:2376)' }
    )
    .optional(),
})

type FormValues = z.infer<typeof schema>

const DEPLOY_MODES: { value: DeployMode; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'standalone',
    label: 'Standalone',
    description: 'Single Supabase stack. Simple and fast.',
    icon: <Server size={16} />,
  },
  {
    value: 'standby',
    label: 'With failover standby',
    description: 'A warm standby promoted automatically in ~90 s if the primary fails.',
    icon: <ShieldCheck size={16} />,
  },
  {
    value: 'cluster',
    label: 'Cluster mode',
    description: 'One master + read replicas. Auto-promotes the next replica on master failure.',
    icon: <Database size={16} />,
  },
]

export function SelfHostedProjectCreation() {
  const router = useRouter()
  const { data: currentOrg } = useSelectedOrganizationQuery()
  const [deployMode, setDeployMode] = useState<DeployMode>('standalone')
  const [isPostCreate, setIsPostCreate] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { projectName: '', dockerHost: '' },
  })

  const { mutateAsync: createProjectAsync, isPending: isCreating } = useProjectCreateMutation()
  const isPending = isCreating || isPostCreate

  const onSubmit = async ({ projectName, dockerHost }: FormValues) => {
    if (!currentOrg) return toast.error('No organization selected')

    const docker_host = dockerHost?.trim() || undefined

    let project: { ref: string } | undefined
    try {
      project = await createProjectAsync({
        name: projectName,
        organizationSlug: currentOrg.slug,
        dbPass: '',
        selfHosted: {
          docker_host,
          ...(deployMode === 'cluster' && { cluster_mode: true }),
        },
      })
    } catch (err) {
      toast.error(`Failed to create project: ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    if (!project) return

    if (deployMode === 'standby') {
      setIsPostCreate(true)
      try {
        const res = await fetch(`/api/platform/projects/${project.ref}/standby`, {
          method: 'POST',
          ...(docker_host && {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docker_host }),
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } catch {
        toast.warning('Project created — standby could not be provisioned. Add it from Settings › General.')
      } finally {
        setIsPostCreate(false)
      }
    }

    router.push(`/project/${project.ref}`)
  }

  const submitLabel = () => {
    if (isPostCreate) return 'Provisioning standby...'
    if (isCreating) return 'Launching stack...'
    return 'Create project'
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
                {submitLabel()}
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
              label="Deployment mode"
              layout="horizontal"
              description="Choose how this project is deployed."
            >
              <div className="flex flex-col gap-2 w-full">
                {DEPLOY_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    disabled={isPending}
                    onClick={() => setDeployMode(mode.value)}
                    className={[
                      'flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                      deployMode === mode.value
                        ? 'border-brand bg-brand-200 text-foreground'
                        : 'border-border-strong bg-surface-100 text-foreground-light hover:border-foreground-muted',
                    ].join(' ')}
                  >
                    <span className="mt-0.5 shrink-0">{mode.icon}</span>
                    <span>
                      <span className="block text-sm font-medium">{mode.label}</span>
                      <span className="block text-xs text-foreground-light">{mode.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </FormItemLayout>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-foreground-lighter hover:text-foreground transition-colors"
            >
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Advanced options
            </button>

            {showAdvanced && (
              <FormField_Shadcn_
                control={form.control}
                name="dockerHost"
                render={({ field }) => (
                  <FormItemLayout
                    label="External Docker host"
                    layout="horizontal"
                    description={
                      <>
                        Target a remote Docker daemon (e.g.{' '}
                        <code className="text-xs">ssh://user@192.168.1.10</code> or{' '}
                        <code className="text-xs">tcp://host:2376</code>). Leave blank to use
                        the local Docker daemon.
                      </>
                    }
                  >
                    <FormControl_Shadcn_>
                      <Input
                        placeholder="ssh://user@host"
                        disabled={isPending}
                        {...field}
                      />
                    </FormControl_Shadcn_>
                  </FormItemLayout>
                )}
              />
            )}
          </Panel.Content>
        </Panel>
      </form>
    </Form_Shadcn_>
  )
}
