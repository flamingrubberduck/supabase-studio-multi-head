import { ExternalLink, Plus, RefreshCw, Trash2 } from 'lucide-react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from 'ui'

import { AppLayout } from '@/components/layouts/AppLayout/AppLayout'
import { DefaultLayout } from '@/components/layouts/DefaultLayout'
import { PageLayout } from '@/components/layouts/PageLayout/PageLayout'
import { ScaffoldContainer, ScaffoldSection } from '@/components/layouts/Scaffold'
import {
  type OrgProject,
  useOrgProjectsInfiniteQuery,
} from '@/data/projects/org-projects-infinite-query'
import { useProjectDeleteMutation } from '@/data/projects/project-delete-mutation'
import { withAuth } from '@/hooks/misc/withAuth'
import type { NextPageWithLayout } from '@/types'

const DEFAULT_ORG_SLUG = 'default-org-slug'

// OrgProject from api-types doesn't include our custom fields — extend locally
type SelfHostedProject = OrgProject & {
  public_url?: string
  kong_http_port?: number
}

function statusBadgeVariant(
  status: string | undefined
): 'default' | 'warning' | 'success' | 'destructive' | 'secondary' {
  switch (status) {
    case 'ACTIVE_HEALTHY':
      return 'success'
    case 'COMING_UP':
    case 'RESTORING':
      return 'warning'
    case 'INACTIVE':
    case 'REMOVED':
      return 'destructive'
    default:
      return 'default'
  }
}

const ProjectsPage: NextPageWithLayout = () => {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState<SelfHostedProject | null>(null)

  const { data, isPending, isFetching, refetch } = useOrgProjectsInfiniteQuery(
    { slug: DEFAULT_ORG_SLUG },
    {
      // Poll while any project is still coming up
      refetchInterval: (query) => {
        const projects = query.state.data?.pages.flatMap((p) => p?.projects ?? []) ?? []
        const hasTransient = projects.some(
          (p) => p.status === 'COMING_UP' || p.status === 'RESTORING'
        )
        return hasTransient ? 4000 : false
      },
    }
  )

  const projects = (data?.pages.flatMap((p) => p?.projects ?? []) ??
    []) as SelfHostedProject[]

  const { mutate: deleteProject, isPending: isDeleting } = useProjectDeleteMutation({
    onSuccess: () => setConfirmDelete(null),
  })

  return (
    <>
      <Head>
        <title>Projects — Supabase</title>
      </Head>

      <ScaffoldContainer>
        <ScaffoldSection isFullWidth className="flex flex-col gap-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <p className="text-foreground-muted text-sm">
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="default"
                icon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />}
                onClick={() => refetch()}
                disabled={isFetching}
              >
                Refresh
              </Button>
              <Button asChild type="primary" icon={<Plus size={14} />}>
                <Link href={`/new/${DEFAULT_ORG_SLUG}`}>New project</Link>
              </Button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-md border border-strong overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending && (
                  <>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}

                {!isPending && projects.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-foreground-muted py-10">
                      No projects yet.{' '}
                      <Link
                        href={`/new/${DEFAULT_ORG_SLUG}`}
                        className="text-foreground underline underline-offset-2"
                      >
                        Create one
                      </Link>
                      .
                    </TableCell>
                  </TableRow>
                )}

                {projects.map((project) => (
                  <TableRow
                    key={project.ref}
                    className="cursor-pointer"
                    onClick={() => router.push(`/project/${project.ref}`)}
                  >
                    <TableCell className="font-medium">{project.name}</TableCell>

                    <TableCell>
                      <Badge variant={statusBadgeVariant(project.status ?? undefined)}>
                        {project.status ?? '—'}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-foreground-muted text-sm">
                      {project.public_url ? (
                        <a
                          href={project.public_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 hover:text-foreground hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {project.public_url}
                          <ExternalLink size={11} />
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>

                    <TableCell className="text-foreground-muted text-sm">
                      {project.inserted_at
                        ? new Date(project.inserted_at).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </TableCell>

                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {project.ref !== 'default' && (
                        <Button
                          type="danger"
                          icon={<Trash2 size={14} />}
                          onClick={() => setConfirmDelete(project)}
                        >
                          Delete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </ScaffoldSection>
      </ScaffoldContainer>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setConfirmDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{confirmDelete?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the project, stop its Docker stack, and remove all
              associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={() => {
                if (confirmDelete) {
                  deleteProject({
                    projectRef: confirmDelete.ref,
                    organizationSlug: DEFAULT_ORG_SLUG,
                  })
                }
              }}
            >
              {isDeleting ? 'Deleting…' : 'Delete project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

ProjectsPage.getLayout = (page) => (
  <AppLayout>
    <DefaultLayout hideMobileMenu headerTitle="Projects">
      <PageLayout title="Projects" className="max-w-[1200px] lg:px-6 mx-auto">
        {page}
      </PageLayout>
    </DefaultLayout>
  </AppLayout>
)

export default withAuth(ProjectsPage)
