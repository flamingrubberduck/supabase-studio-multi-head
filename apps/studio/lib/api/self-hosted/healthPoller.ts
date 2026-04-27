import { getStoredProjects, updateProjectFields } from './projectsStore'
import { triggerFailover } from './failoverManager'

const POLL_INTERVAL_MS = 30_000
const FAILURE_THRESHOLD = 3
const HEALTH_TIMEOUT_MS = 5_000

async function checkHealth(publicUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${publicUrl}/rest/v1/`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    return res.ok || res.status === 401
  } catch {
    return false
  }
}

async function pollOnce(): Promise<void> {
  const projects = getStoredProjects()
  for (const project of projects) {
    if (project.ref === 'default') continue
    if (project.role === 'standby') continue
    if (project.status === 'COMING_UP' || project.status === 'INACTIVE') continue

    const healthy = await checkHealth(project.public_url)

    if (healthy) {
      if ((project.failure_streak ?? 0) > 0) {
        updateProjectFields(project.ref, { failure_streak: 0 })
      }
      continue
    }

    const streak = (project.failure_streak ?? 0) + 1
    console.warn(`[failover] ${project.name} (${project.ref}) health miss #${streak}`)

    if (streak >= FAILURE_THRESHOLD) {
      // Reset streak before triggering so a re-entry of pollOnce doesn't double-trigger
      updateProjectFields(project.ref, { failure_streak: 0 })
      triggerFailover(project.ref).catch((err) => {
        console.error(`[failover] triggerFailover failed for ${project.ref}:`, err)
      })
    } else {
      updateProjectFields(project.ref, { failure_streak: streak })
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __healthPollerStarted: boolean | undefined
}

export function startHealthPoller(): void {
  if (globalThis.__healthPollerStarted) return
  globalThis.__healthPollerStarted = true

  // Wait one full interval before the first poll — lets services come up after server start
  setTimeout(() => {
    pollOnce().catch(console.error)
    setInterval(() => pollOnce().catch(console.error), POLL_INTERVAL_MS)
  }, POLL_INTERVAL_MS)

  console.log(`[failover] Health poller started (interval: ${POLL_INTERVAL_MS / 1000}s, threshold: ${FAILURE_THRESHOLD} misses)`)
}
