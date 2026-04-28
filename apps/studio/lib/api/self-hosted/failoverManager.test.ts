// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./orchestrator', () => ({
  allocateNextPorts: vi.fn(),
  discoverDockerStackPorts: vi.fn(() => []),
  extractDockerHostname: vi.fn((host?: string) => (host ? 'remote-host' : 'localhost')),
  generateProjectCredentials: vi.fn(() => ({
    postgresPassword: 'fresh-pg-pass',
    jwtSecret: 'master-jwt',
    anonKey: 'master-anon',
    serviceKey: 'master-service',
    dashboardPassword: 'dash-pass',
    poolerTenantId: 'tenant-abc',
  })),
  launchProjectStack: vi.fn(() => Promise.resolve('stack-id')),
  teardownProjectStack: vi.fn(() => Promise.resolve()),
  waitForProjectHealth: vi.fn(() => Promise.resolve()),
}))

vi.mock('./replicationManager', () => ({
  setupReplication: vi.fn(() => Promise.resolve()),
  promoteStandby: vi.fn(() => Promise.resolve()),
  dropReplicationSlot: vi.fn(),
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smh-failover-test-'))
  vi.stubEnv('STUDIO_DATA_DIR', tmpDir)
  vi.stubEnv('SUPABASE_PUBLIC_URL', 'http://localhost:8000')
  vi.stubEnv('AUTH_JWT_SECRET', '')
  vi.stubEnv('SUPABASE_ANON_KEY', '')
  vi.stubEnv('SUPABASE_SERVICE_KEY', '')
  vi.resetModules()
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

async function makeProject(
  overrides: Record<string, unknown> = {}
): Promise<import('./projectsStore').StoredProject> {
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

// ─────────────────────────────────────────────────────────────────────────────
// provisionStandby
// ─────────────────────────────────────────────────────────────────────────────

describe('provisionStandby', () => {
  it('creates standby entry and links primary ↔ standby refs', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const primary = await makeProject()
    const { provisionStandby } = await import('./failoverManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const standbyRef = await provisionStandby(primary.ref)

    const updatedPrimary = getStoredProjectByRef(primary.ref)
    const standby = getStoredProjectByRef(standbyRef)

    expect(standby).toBeDefined()
    expect(standby!.role).toBe('standby')
    expect(standby!.primary_ref).toBe(primary.ref)
    expect(updatedPrimary!.role).toBe('primary')
    expect(updatedPrimary!.standby_ref).toBe(standbyRef)
  })

  it('inherits primary JWT/anon/service keys so tokens survive failover', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })
    vi.mocked(orch.generateProjectCredentials).mockReturnValue({
      postgresPassword: 'fresh-pg-pass',
      jwtSecret: 'SHOULD-BE-OVERRIDDEN',
      anonKey: 'SHOULD-BE-OVERRIDDEN',
      serviceKey: 'SHOULD-BE-OVERRIDDEN',
      dashboardPassword: 'dash-pass',
      poolerTenantId: 'new-tenant',
    })

    const primary = await makeProject({
      jwt_secret: 'primary-jwt',
      anon_key: 'primary-anon',
      service_key: 'primary-service',
    })
    const { provisionStandby } = await import('./failoverManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const standbyRef = await provisionStandby(primary.ref)
    const standby = getStoredProjectByRef(standbyRef)

    expect(standby!.jwt_secret).toBe('primary-jwt')
    expect(standby!.anon_key).toBe('primary-anon')
    expect(standby!.service_key).toBe('primary-service')
    // But infra credentials are fresh
    expect(standby!.db_password).toBe('fresh-pg-pass')
  })

  it('throws if primary already has a standby', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const primary = await makeProject()
    const { provisionStandby } = await import('./failoverManager')

    await provisionStandby(primary.ref)
    await expect(provisionStandby(primary.ref)).rejects.toThrow('already has a standby')
  })

  it('throws if project does not exist', async () => {
    const { provisionStandby } = await import('./failoverManager')
    await expect(provisionStandby('nonexistent-ref')).rejects.toThrow('not found')
  })

  it('throws if trying to provision standby for a standby', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const primary = await makeProject()
    const { provisionStandby } = await import('./failoverManager')
    const { getStoredProjectByRef, updateProjectFields } = await import('./projectsStore')

    const standbyRef = await provisionStandby(primary.ref)
    // The standby hasn't completed launch in background so no standby_ref set yet —
    // mark it manually to simulate a fully set up standby
    updateProjectFields(standbyRef, { role: 'standby' })

    await expect(provisionStandby(standbyRef)).rejects.toThrow('Cannot provision a standby for a standby')
    void getStoredProjectByRef // satisfy lint
  })

  it('uses targetDockerHost when provided', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })
    vi.mocked(orch.extractDockerHostname).mockReturnValue('standby-host.example.com')

    const primary = await makeProject()
    const { provisionStandby } = await import('./failoverManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const standbyRef = await provisionStandby(primary.ref, 'ssh://user@standby-host.example.com')
    const standby = getStoredProjectByRef(standbyRef)

    expect(standby!.docker_host).toBe('ssh://user@standby-host.example.com')
    expect(orch.extractDockerHostname).toHaveBeenCalledWith('ssh://user@standby-host.example.com')
  })

  it('assigns correct ports from allocateNextPorts', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 9100,
      kongHttpsPort: 9101,
      postgresPort: 5499,
      poolerPort: 6599,
    })

    const primary = await makeProject()
    const { provisionStandby } = await import('./failoverManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const standbyRef = await provisionStandby(primary.ref)
    const standby = getStoredProjectByRef(standbyRef)

    expect(standby!.kong_http_port).toBe(9100)
    expect(standby!.postgres_port).toBe(5499)
    expect(standby!.pooler_port).toBe(6599)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// triggerFailover
// ─────────────────────────────────────────────────────────────────────────────

describe('triggerFailover', () => {
  async function setupPrimaryWithStandby() {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const primary = await makeProject({
      public_url: 'http://localhost:8100',
      kong_http_port: 8100,
      postgres_port: 5433,
      docker_project: 'supabase-primary',
    })
    const { provisionStandby } = await import('./failoverManager')
    // Wait for the synchronous store writes (async parts are mocked)
    const standbyRef = await provisionStandby(primary.ref)

    // Mark standby healthy (background provisioning is mocked and returns immediately)
    const { updateProjectStatus, getStoredProjectByRef } = await import('./projectsStore')
    updateProjectStatus(standbyRef, 'ACTIVE_HEALTHY')

    return { primary, standbyRef, getStoredProjectByRef }
  }

  it('swaps standby connection details onto primary registry entry', async () => {
    const { primary, standbyRef, getStoredProjectByRef } = await setupPrimaryWithStandby()
    const { triggerFailover } = await import('./failoverManager')

    await triggerFailover(primary.ref)

    const promoted = getStoredProjectByRef(primary.ref)
    // Primary ref is unchanged but now points to standby's ports
    expect(promoted!.kong_http_port).toBe(8200)
    expect(promoted!.postgres_port).toBe(5434)
    expect(promoted!.pooler_port).toBe(6545)
    void standbyRef
  })

  it('increments failover_count and records last_failover_at', async () => {
    const { primary, getStoredProjectByRef } = await setupPrimaryWithStandby()
    const { triggerFailover } = await import('./failoverManager')

    await triggerFailover(primary.ref)

    const promoted = getStoredProjectByRef(primary.ref)
    expect(promoted!.failover_count).toBe(1)
    expect(promoted!.last_failover_at).toBeDefined()
  })

  it('increments failover_count additively on successive failovers', async () => {
    // Set up a primary with failover_count already at 2
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce({ kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545 })
      .mockReturnValue({ kongHttpPort: 8300, kongHttpsPort: 8301, postgresPort: 5435, poolerPort: 6546 })

    const primary = await makeProject()
    const { updateProjectFields, updateProjectStatus, getStoredProjectByRef } = await import('./projectsStore')
    // Apply the initial failover_count (createStoredProject doesn't accept this field)
    updateProjectFields(primary.ref, { failover_count: 2 })

    const { provisionStandby, triggerFailover } = await import('./failoverManager')

    const standbyRef = await provisionStandby(primary.ref)
    updateProjectStatus(standbyRef, 'ACTIVE_HEALTHY')

    await triggerFailover(primary.ref)

    const promoted = getStoredProjectByRef(primary.ref)
    expect(promoted!.failover_count).toBe(3)
  })

  it('removes standby entry from registry after promotion', async () => {
    const { primary, standbyRef, getStoredProjectByRef } = await setupPrimaryWithStandby()
    const { triggerFailover } = await import('./failoverManager')

    await triggerFailover(primary.ref)

    expect(getStoredProjectByRef(standbyRef)).toBeUndefined()
  })

  it('calls promoteStandby before swapping connection details', async () => {
    const { primary } = await setupPrimaryWithStandby()
    const repl = await import('./replicationManager')
    const { triggerFailover } = await import('./failoverManager')

    await triggerFailover(primary.ref)

    expect(repl.promoteStandby).toHaveBeenCalledOnce()
  })

  it('resets failure_streak and increments failover_count on primary after failover', async () => {
    const { primary, getStoredProjectByRef } = await setupPrimaryWithStandby()
    const { updateProjectFields } = await import('./projectsStore')
    // Simulate prior health misses
    updateProjectFields(primary.ref, { failure_streak: 2 })

    const { triggerFailover } = await import('./failoverManager')

    await triggerFailover(primary.ref)

    const promoted = getStoredProjectByRef(primary.ref)
    // failure_streak is reset to 0 during the swap
    expect(promoted!.failure_streak).toBe(0)
    expect(promoted!.failover_count).toBe(1)
  })

  it('marks primary INACTIVE if no standby configured', async () => {
    const primary = await makeProject({ public_url: 'http://localhost:8100' })
    const { triggerFailover } = await import('./failoverManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    await triggerFailover(primary.ref)

    const updated = getStoredProjectByRef(primary.ref)
    expect(updated!.status).toBe('INACTIVE')
  })

  it('marks primary INACTIVE if standby_ref points to missing project', async () => {
    const { updateProjectFields } = await import('./projectsStore')
    const primary = await makeProject()
    updateProjectFields(primary.ref, { standby_ref: 'ghost-ref', role: 'primary' })

    const { triggerFailover } = await import('./failoverManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    await triggerFailover(primary.ref)

    const updated = getStoredProjectByRef(primary.ref)
    expect(updated!.status).toBe('INACTIVE')
  })

  it('throws if primary ref does not exist', async () => {
    const { triggerFailover } = await import('./failoverManager')
    await expect(triggerFailover('nonexistent')).rejects.toThrow('not found')
  })

  it('tears down old primary stack in background', async () => {
    const { primary } = await setupPrimaryWithStandby()
    const orch = await import('./orchestrator')
    const { triggerFailover } = await import('./failoverManager')

    await triggerFailover(primary.ref)

    // Give the background teardown a tick to be called
    await new Promise((r) => setTimeout(r, 0))
    expect(orch.teardownProjectStack).toHaveBeenCalledWith(
      primary.ref,
      'supabase-primary',
      undefined
    )
  })

  it('provisions replacement standby in background after failover', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce({ kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545 })
      .mockReturnValue({ kongHttpPort: 8300, kongHttpsPort: 8301, postgresPort: 5435, poolerPort: 6546 })

    const primary = await makeProject()
    const { provisionStandby, triggerFailover } = await import('./failoverManager')
    const { updateProjectStatus } = await import('./projectsStore')

    const standbyRef = await provisionStandby(primary.ref)
    updateProjectStatus(standbyRef, 'ACTIVE_HEALTHY')

    await triggerFailover(primary.ref)
    // Allow background provisionStandby to kick off
    await new Promise((r) => setTimeout(r, 10))

    // launchProjectStack called twice: once for standby, once for replacement
    expect(orch.launchProjectStack).toHaveBeenCalledTimes(2)
  })
})
