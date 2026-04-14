import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Button, Form_Shadcn_, FormControl_Shadcn_, FormField_Shadcn_ } from 'ui'
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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { projectName: '' },
  })

  const { mutate: createProject, isPending } = useProjectCreateMutation({
    onSuccess: (res) => {
      router.push(`/project/${res.ref}`)
    },
    onError: (err) => {
      toast.error(`Failed to create project: ${err.message}`)
    },
  })

  const onSubmit = ({ projectName }: FormValues) => {
    if (!currentOrg) return toast.error('No organization selected')
    createProject({
      name: projectName,
      organizationSlug: currentOrg.slug,
      dbPass: '', // credentials are auto-generated server-side
    })
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
                {isPending ? 'Launching stack...' : 'Create project'}
              </Button>
            </div>
          }
        >
          <Panel.Content>
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
          </Panel.Content>
        </Panel>
      </form>
    </Form_Shadcn_>
  )
}
