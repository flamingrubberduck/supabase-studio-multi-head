import { useRouter } from 'next/router'
import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'ui'
import { MoreHorizontal, Database, Code, Trash2, Play, Square } from 'lucide-react'

import { useSelfHostedProjectDeleteMutation } from '@/data/self-hosted-projects/self-hosted-project-delete-mutation'
import type { SelfHostedProject } from '@/data/self-hosted-projects/self-hosted-projects-query'
import { useProjectStartMutation, useProjectStopMutation } from './useProjectLifecycleMutations'

interface ProjectCardProps {
  project: SelfHostedProject
}

const STATUS_BADGE: Record<
  SelfHostedProject['status'],
  { label: string; variant: 'default' | 'destructive' | 'warning' | 'outline' }
> = {
  active: { label: 'Active', variant: 'default' },
  creating: { label: 'Creating…', variant: 'warning' },
  stopped: { label: 'Stopped', variant: 'outline' },
  error: { label: 'Error', variant: 'destructive' },
}

const HEALTH_DOT: Record<
  NonNullable<SelfHostedProject['health']>['overall'],
  string
> = {
  healthy: 'bg-brand',
  degraded: 'bg-warning',
  offline: 'bg-destructive',
}

export function ProjectCard({ project }: ProjectCardProps) {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { mutate: deleteProject, isPending: isDeleting } = useSelfHostedProjectDeleteMutation()
  const { mutate: startProject, isPending: isStarting } = useProjectStartMutation()
  const { mutate: stopProject, isPending: isStopping } = useProjectStopMutation()

  const { label: statusLabel, variant: statusVariant } = STATUS_BADGE[project.status]
  const healthColor = project.health ? HEALTH_DOT[project.health.overall] : 'bg-foreground-muted'

  const isBusy = isDeleting || isStarting || isStopping || project.status === 'creating'

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-col gap-3 pt-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`mt-0.5 size-2 shrink-0 rounded-full ${healthColor}`} />
            <h3 className="text-sm font-medium truncate">{project.name}</h3>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="text" icon={<MoreHorizontal size={14} />} className="px-1 h-6 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {project.status === 'stopped' && (
                <DropdownMenuItem
                  onClick={() => startProject(project.ref)}
                  disabled={isBusy}
                  icon={<Play size={14} />}
                >
                  Start
                </DropdownMenuItem>
              )}
              {project.status === 'active' && (
                <DropdownMenuItem
                  onClick={() => stopProject(project.ref)}
                  disabled={isBusy}
                  icon={<Square size={14} />}
                >
                  Stop
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {confirmDelete ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => deleteProject(project.ref)}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting…' : 'Confirm delete'}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                  icon={<Trash2 size={14} />}
                >
                  Delete project
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant} className="text-xs">
            {statusLabel}
          </Badge>
          <span className="text-xs text-foreground-lighter font-mono">{project.ref}</span>
        </div>

        {/* Service health breakdown */}
        {project.health && (
          <div className="text-xs text-foreground-light space-y-0.5">
            {(['db', 'meta', 'rest', 'auth'] as const).map((svc) => (
              <div key={svc} className="flex items-center gap-1.5">
                <span
                  className={`size-1.5 rounded-full ${
                    project.health![svc] === 'running'
                      ? 'bg-brand'
                      : project.health![svc] === 'stopped'
                        ? 'bg-foreground-muted'
                        : 'bg-destructive'
                  }`}
                />
                <span className="capitalize">{svc}</span>
                <span className="text-foreground-lighter">
                  :{project.ports?.[svc as keyof typeof project.ports]}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CardFooter className="gap-2 mt-auto pt-0">
        <Button
          type="default"
          size="small"
          disabled={project.status !== 'active' || isBusy}
          icon={<Database size={14} />}
          onClick={() => router.push(`/project/${project.ref}/editor`)}
          className="flex-1"
        >
          Table editor
        </Button>
        <Button
          type="default"
          size="small"
          disabled={project.status !== 'active' || isBusy}
          icon={<Code size={14} />}
          onClick={() => router.push(`/project/${project.ref}/sql/new`)}
          className="flex-1"
        >
          SQL editor
        </Button>
      </CardFooter>
    </Card>
  )
}
