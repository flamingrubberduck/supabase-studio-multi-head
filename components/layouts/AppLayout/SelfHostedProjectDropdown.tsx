import { Box, ChevronsUpDown, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import {
  Button,
  cn,
  Command_Shadcn_,
  CommandEmpty_Shadcn_,
  CommandGroup_Shadcn_,
  CommandInput_Shadcn_,
  CommandItem_Shadcn_,
  CommandList_Shadcn_,
  CommandSeparator_Shadcn_,
  Popover_Shadcn_,
  PopoverContent_Shadcn_,
  PopoverTrigger_Shadcn_,
} from 'ui'

import { sanitizeRoute } from './ProjectDropdown.utils'
import { useSelfHostedProjectsQuery } from '@/data/self-hosted-projects/self-hosted-projects-query'
import { DEFAULT_PROJECT } from '@/lib/constants/api'

const HEALTH_DOT: Record<string, string> = {
  healthy: 'bg-brand',
  degraded: 'bg-warning',
  offline: 'bg-destructive',
}

interface SelfHostedProjectDropdownProps {
  currentRef: string | undefined
  currentName: string
}

export function SelfHostedProjectDropdown({
  currentRef,
  currentName,
}: SelfHostedProjectDropdownProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { data: projects = [] } = useSelfHostedProjectsQuery({ refetchInterval: 10_000 })

  const allProjects = [
    {
      id: DEFAULT_PROJECT.id,
      ref: DEFAULT_PROJECT.ref,
      name: DEFAULT_PROJECT.name,
      status: 'active' as const,
      health: null as null | { overall: string },
    },
    ...projects,
  ]

  function navigate(ref: string) {
    const sanitized = sanitizeRoute(router.route, router.query)
    const href = sanitized?.replace('[ref]', ref) ?? `/project/${ref}`
    setOpen(false)
    router.push(href)
  }

  return (
    <Popover_Shadcn_ open={open} onOpenChange={setOpen} modal={false}>
      <div className="flex items-center flex-shrink-0">
        <Link
          href={`/project/${currentRef}`}
          className="flex items-center gap-2 flex-shrink-0 text-sm"
        >
          <Box size={14} strokeWidth={1.5} className="text-foreground-lighter" />
          <span
            title={currentName}
            className="text-foreground max-w-32 lg:max-w-64 truncate"
          >
            {currentName}
          </span>
        </Link>

        <PopoverTrigger_Shadcn_ asChild>
          <Button
            size="tiny"
            type="text"
            className="px-1.5 py-4 [&_svg]:w-5 [&_svg]:h-5 ml-1 flex-shrink-0"
            iconRight={<ChevronsUpDown strokeWidth={1.5} />}
          />
        </PopoverTrigger_Shadcn_>
      </div>

      <PopoverContent_Shadcn_ className="p-0 w-64" side="bottom" align="start">
        <Command_Shadcn_>
          <CommandInput_Shadcn_ placeholder="Find project..." />
          <CommandList_Shadcn_>
            <CommandEmpty_Shadcn_>No projects found</CommandEmpty_Shadcn_>

            <CommandGroup_Shadcn_>
              {allProjects.map((project) => {
                const healthColor = project.health
                  ? HEALTH_DOT[project.health.overall] ?? 'bg-foreground-muted'
                  : 'bg-brand'
                const isSelected = project.ref === currentRef

                return (
                  <CommandItem_Shadcn_
                    key={project.ref}
                    value={`${project.name} ${project.ref}`}
                    onSelect={() => navigate(project.ref)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center gap-2 w-full min-w-0">
                      <span
                        className={cn('size-2 shrink-0 rounded-full', healthColor)}
                      />
                      <span
                        className={cn(
                          'truncate text-sm',
                          isSelected ? 'text-foreground' : 'text-foreground-light'
                        )}
                      >
                        {project.name}
                      </span>
                      {isSelected && (
                        <span className="ml-auto text-brand text-xs shrink-0">current</span>
                      )}
                    </div>
                  </CommandItem_Shadcn_>
                )
              })}
            </CommandGroup_Shadcn_>

            <CommandSeparator_Shadcn_ />

            <CommandGroup_Shadcn_>
              <CommandItem_Shadcn_
                onSelect={() => {
                  setOpen(false)
                  router.push('/projects')
                }}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-2 text-foreground-light">
                  <Plus size={14} strokeWidth={1.5} />
                  <span className="text-sm">New project</span>
                </div>
              </CommandItem_Shadcn_>
            </CommandGroup_Shadcn_>
          </CommandList_Shadcn_>
        </Command_Shadcn_>
      </PopoverContent_Shadcn_>
    </Popover_Shadcn_>
  )
}
