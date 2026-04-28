// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./failoverManager', () => ({
  triggerFailover: vi.fn(() => Promise.resolve()),
  provisionStandby: vi.fn(() => Promise.resolve('standby-ref')),
}))

vi.mock('./clusterManager', () => ({
  triggerClusterFailover: vi.fn(() => Promise.resolve()),
  provisionReplica: vi.fn(() => Promise.resolve('replica-ref')),
  deprovisionReplica: vi.fn(() => Promise.resolve()),
}))

vi.mock('./licenseManager', () => ({
  getLicenseTier: vi.fn(() => 'pro'),
}))

vi.mock('@/lib/constants/api', () => ({
  DEFAULT_PROJECT: {
    id: 0,
    ref: 'default',
    name: 'Default Project',
    organization_id: 1,
    cloud_provider: 'localhost',
    status: 'ACTIVE_HEALTHY',
    region: 'local',
    inserted_at: '2024-01-01T00:00:00Z',
  },
}))

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smh-poller-test-'))
  vi.stubEnv('STUDIO_DATA_DIR', tmpDir)
  vi.stubEnv('SUPABASE_PUBLIC_URL', 'http://localhost:8000')
  vi.stubEnv('AUTH_JWT_SECRET', '')
  vi.stubEnv('SUPABASE_ANON_KEY', '')
  vi.stubEnv('SUPABASE_SERVICE_KEY', '')
  vi.resetModules()
  // Reset the global poller flag so each test starts fresh
  ;(globalThis as Record<string, unknown>).__healthPollerStarted = false
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
  ;(globalThis as Record<string, unknown>).__healthPollerStarted = false
})

async function makeProject(overrides: Record<string, unknown> = {}) {
  const { createStoredProject } = await import('./projectsStore')
  return createStoredProject({
    name: 'test-project',
    organization_slug: 'default-org-slug',
    public_url: 'http://localhost:8100',
    postgres_port: 5433,
    kong_http_port: 8100,
    pooler_port: 6544,
    pooler_tenant_id: 'tenant-1',
    docker_project: 'supabase-test',
    db_password: 'pg-pass',
    anon_key: 'anon-key',
    service_key: 'service-key',
    jwt_secret: 'jwt-secret',
    status: 'ACTIVE_HEALTHY',
    ...overrides,
  })
}

/**
 * Drives a single health poll cycle by:
 *  1. Switching to fake timers and clearing any existing ones
 *  2. Starting the health poller (delayed by POLL_INTERVAL_MS = 30_000)
 *  3. Advancing time past the initial delay to trigger first poll
 *  4. Flushing microtasks so async poll logic completes
 *  5. Clearing the setInterval and restoring real timers
 */
async function runOnePollCycle(fetchMock: (url: string) => Promise<Response>) {
  vi.stubGlobal('fetch', fetchMock)

  vi.useFakeTimers()
  vi.clearAllTimers()

  const { startHealthPoller } = await import('./healthPoller')
  startHealthPoller()

  // Advance past the initial 30s delay — triggers the first setTimeout callback,
  // which runs pollOnce() and starts the setInterval.
  await vi.advanceTimersByTimeAsync(30_001)

  // Flush microtasks from the async poll coroutine (for-of loop + await fetch)
  for (let i = 0; i < 20; i++) await Promise.resolve()

  // Stop the repeating setInterval so we don't loop infinitely
  vi.clearAllTimers()
  vi.useRealTimers()
}

// ─────────────────────────────────────────────────────────────────────────────
// Streak counting
// ─────────────────────────────────────────────────────────────────────────────

describe('health poller — streak counting', () => {
  it('increments failure_streak on health miss', async () => {
    const project = await makeProject()
    await runOnePollCycle(async () => new Response(null, { status: 500 }))

    const { getStoredProjectByRef } = await import('./projectsStore')
    expect(getStoredProjectByRef(project.ref)!.failure_streak).toBe(1)
  })

  it('resets failure_streak to 0 on healthy response', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { failure_streak: 2 })

    await runOnePollCycle(async () => new Response(null, { status: 200 }))

    const { getStoredProjectByRef } = await import('./projectsStore')
    expect(getStoredProjectByRef(project.ref)!.failure_streak).toBe(0)
  })

  it('accepts 401 as healthy (auth up, anon key wrong)', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { failure_streak: 1 })

    await runOnePollCycle(async () => new Response(null, { status: 401 }))

    const { getStoredProjectByRef } = await import('./projectsStore')
    expect(getStoredProjectByRef(project.ref)!.failure_streak).toBe(0)
  })

  it('accumulates streak across consecutive misses without triggering failover', async () => {
    const project = await makeProject()

    // First miss
    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    let { getStoredProjectByRef } = await import('./projectsStore')
    expect(getStoredProjectByRef(project.ref)!.failure_streak).toBe(1)

    // Reset poller flag for second cycle (same test)
    ;(globalThis as Record<string, unknown>).__healthPollerStarted = false

    // Second miss
    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    ;({ getStoredProjectByRef } = await import('./projectsStore'))
    expect(getStoredProjectByRef(project.ref)!.failure_streak).toBe(2)

    // Failover should NOT have been called (only 2 misses, threshold is 3)
    const failoverMgr = await import('./failoverManager')
    expect(failoverMgr.triggerFailover).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Failover triggers
// ─────────────────────────────────────────────────────────────────────────────

describe('health poller — failover triggers', () => {
  it('triggers triggerFailover for primary/standalone after 3 misses (Pro)', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    // Simulate 2 prior misses — next poll will be miss #3
    updateProjectFields(project.ref, { failure_streak: 2 })

    const failoverMgr = await import('./failoverManager')
    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    // Give background failover trigger a tick to register
    await Promise.resolve()
    expect(failoverMgr.triggerFailover).toHaveBeenCalledWith(project.ref)
  })

  it('triggers triggerClusterFailover for cluster master after 3 misses', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { cluster_id: project.ref, failure_streak: 2 })

    const clusterMgr = await import('./clusterManager')
    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    await Promise.resolve()
    expect(clusterMgr.triggerClusterFailover).toHaveBeenCalledWith(project.ref)
  })

  it('does NOT trigger failover on Free license', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { failure_streak: 2 })

    const licenseMgr = await import('./licenseManager')
    vi.mocked(licenseMgr.getLicenseTier).mockReturnValue('free')

    const failoverMgr = await import('./failoverManager')
    const clusterMgr = await import('./clusterManager')

    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    expect(failoverMgr.triggerFailover).not.toHaveBeenCalled()
    expect(clusterMgr.triggerClusterFailover).not.toHaveBeenCalled()
  })

  it('resets failure_streak to 0 before triggering failover (prevents double-trigger)', async () => {
    const project = await makeProject()
    const { updateProjectFields, getStoredProjectByRef } = await import('./projectsStore')
    updateProjectFields(project.ref, { failure_streak: 2 })

    const failoverMgr = await import('./failoverManager')
    let streakAtTrigger: number | undefined
    vi.mocked(failoverMgr.triggerFailover).mockImplementationOnce(async () => {
      streakAtTrigger = getStoredProjectByRef(project.ref)?.failure_streak
    })

    await runOnePollCycle(async () => new Response(null, { status: 503 }))
    await Promise.resolve()

    expect(streakAtTrigger).toBe(0)
  })

  it('does not trigger failover below the 3-miss threshold', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { failure_streak: 1 }) // only 2nd miss on this poll

    const failoverMgr = await import('./failoverManager')
    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    expect(failoverMgr.triggerFailover).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Role-based skipping
// ─────────────────────────────────────────────────────────────────────────────

describe('health poller — role-based skipping', () => {
  it('skips standby projects — does not poll or increment streak', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { role: 'standby', failure_streak: 2 })

    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }))
    await runOnePollCycle(fetchMock)

    // Standby skipped entirely — streak unchanged, fetch not called
    const { getStoredProjectByRef } = await import('./projectsStore')
    expect(getStoredProjectByRef(project.ref)!.failure_streak).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks replica INACTIVE after 3 misses (does not promote it)', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { role: 'replica', failure_streak: 2 })

    const failoverMgr = await import('./failoverManager')
    const clusterMgr = await import('./clusterManager')

    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    const { getStoredProjectByRef } = await import('./projectsStore')
    expect(getStoredProjectByRef(project.ref)!.status).toBe('INACTIVE')
    expect(failoverMgr.triggerFailover).not.toHaveBeenCalled()
    expect(clusterMgr.triggerClusterFailover).not.toHaveBeenCalled()
  })

  it('increments replica streak below threshold without marking INACTIVE', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { role: 'replica', failure_streak: 0 })

    await runOnePollCycle(async () => new Response(null, { status: 503 }))

    const { getStoredProjectByRef } = await import('./projectsStore')
    const updated = getStoredProjectByRef(project.ref)
    expect(updated!.failure_streak).toBe(1)
    expect(updated!.status).toBe('ACTIVE_HEALTHY')
  })

  it('resets replica failure_streak when it recovers', async () => {
    const project = await makeProject()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(project.ref, { role: 'replica', failure_streak: 1 })

    await runOnePollCycle(async () => new Response(null, { status: 200 }))

    const { getStoredProjectByRef } = await import('./projectsStore')
    expect(getStoredProjectByRef(project.ref)!.failure_streak).toBe(0)
  })

  it('skips COMING_UP and INACTIVE projects', async () => {
    await makeProject({ name: 'coming', status: 'COMING_UP' })
    await makeProject({ name: 'dead', status: 'INACTIVE' })

    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }))
    await runOnePollCycle(fetchMock)

    // Neither project should have been polled
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips the default project', async () => {
    // No additional projects — only the virtual default project exists
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }))
    await runOnePollCycle(fetchMock)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
