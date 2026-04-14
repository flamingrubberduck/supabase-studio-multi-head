import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from 'ui'
import { PageContainer } from 'ui-patterns/PageContainer'
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderMeta,
  PageHeaderSummary,
  PageHeaderTitle,
} from 'ui-patterns/PageHeader'
import { GenericSkeletonLoader } from 'ui-patterns/ShimmeringLoader'

import { CreateProjectSheet } from '@/components/interfaces/SelfHostedProjects/CreateProjectSheet'
import { ProjectCard } from '@/components/interfaces/SelfHostedProjects/ProjectCard'
import DefaultProjectCard from '@/components/interfaces/SelfHostedProjects/DefaultProjectCard'
import DefaultLayout from '@/components/layouts/DefaultLayout'
import { useSelfHostedProjectsQuery } from '@/data/self-hosted-projects/self-hosted-projects-query'
import type { NextPageWithLayout } from '@/types'

const ProjectsPage: NextPageWithLayout = () => {
  const [createOpen, setCreateOpen] = useState(false)
  const { data: projects, isLoading } = useSelfHostedProjectsQuery({
    refetchInterval: 10_000,
  })

  return (
    <>
      <PageHeader size="large">
        <PageHeaderMeta>
          <PageHeaderSummary>
            <PageHeaderTitle>Projects</PageHeaderTitle>
            <PageHeaderDescription>
              Manage your self-hosted Supabase projects
            </PageHeaderDescription>
          </PageHeaderSummary>
          <Button icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            New project
          </Button>
        </PageHeaderMeta>
      </PageHeader>

      <PageContainer size="large">
        {isLoading ? (
          <GenericSkeletonLoader />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <DefaultProjectCard />
            {(projects ?? []).map((project) => (
              <ProjectCard key={project.ref} project={project} />
            ))}
          </div>
        )}
      </PageContainer>

      <CreateProjectSheet open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

ProjectsPage.getLayout = (page) => <DefaultLayout>{page}</DefaultLayout>

export default ProjectsPage
