import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/router'
import { SubmitHandler, useForm } from 'react-hook-form'
import {
  Button,
  Form_Shadcn_,
  FormControl_Shadcn_,
  FormField_Shadcn_,
  Input,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetSection,
  SheetTitle,
} from 'ui'
import { Admonition } from 'ui-patterns'
import { FormItemLayout } from 'ui-patterns/form/FormItemLayout/FormItemLayout'
import * as z from 'zod'

import { useSelfHostedProjectCreateMutation } from '@/data/self-hosted-projects/self-hosted-project-create-mutation'

const FormSchema = z.object({
  name: z
    .string()
    .min(3, 'Project name must be at least 3 characters')
    .max(40, 'Project name must be 40 characters or fewer')
    .regex(/^[a-zA-Z0-9 _-]+$/, 'Only letters, numbers, spaces, hyphens, and underscores allowed'),
})

type FormValues = z.infer<typeof FormSchema>

interface CreateProjectSheetProps {
  open: boolean
  onOpenChange: (value: boolean) => void
}

export function CreateProjectSheet({ open, onOpenChange }: CreateProjectSheetProps) {
  const router = useRouter()
  const { mutate: createProject, isPending } = useSelfHostedProjectCreateMutation()

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '' },
  })

  const onSubmit: SubmitHandler<FormValues> = ({ name }) => {
    createProject(name, {
      onSuccess: (project) => {
        form.reset()
        onOpenChange(false)
        router.push(`/project/${project.ref}`)
      },
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="sm">
        <SheetHeader>
          <SheetTitle>New project</SheetTitle>
        </SheetHeader>

        <Form_Shadcn_ {...form}>
          <form id="create-project-form" onSubmit={form.handleSubmit(onSubmit)}>
            <SheetSection>
              <Admonition
                type="default"
                title="What gets created"
                description="A new Postgres database and pg-meta service will be spun up as Docker containers on this host. Auth, Storage, and Realtime can be added later."
              />

              <FormField_Shadcn_
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItemLayout
                    layout="vertical"
                    label="Project name"
                    description="Used as the project identifier. Only letters, numbers, spaces, hyphens, and underscores."
                  >
                    <FormControl_Shadcn_>
                      <Input
                        {...field}
                        placeholder="my-project"
                        autoFocus
                        autoComplete="off"
                        disabled={isPending}
                      />
                    </FormControl_Shadcn_>
                  </FormItemLayout>
                )}
              />
            </SheetSection>
          </form>
        </Form_Shadcn_>

        <SheetFooter>
          <Button type="default" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            form="create-project-form"
            htmlType="submit"
            loading={isPending}
            disabled={!form.formState.isDirty}
          >
            Create project
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
