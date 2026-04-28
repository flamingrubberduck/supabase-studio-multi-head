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
    jwtSecret: 'SHOULD-NOT-BE-USED',
    anonKey: 'SHOULD-NOT-BE-USED',
    serviceKey: 'SHOULD-NOT-BE-USED',
    dashboardPassword: 'dash-pass',
    poolerTenantId: 'tenant-new',
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smh-cluster-test-'))
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

async function makeMaster(overrides: Record<string, unknown> = {}) {
  const { createStoredProject } = await import('./projectsStore')
  return createStoredProject({
    name: 'my-cluster',
    organization_slug: 'default-org-slug',
    public_url: 'http://localhost:8100',
    postgres_port: 5433,
    kong_http_port: 8100,
    pooler_port: 6544,
    pooler_tenant_id: 'tenant-master',
    docker_project: 'supabase-master',
    db_password: 'master-pg',
    anon_key: 'master-anon',
    service_key: 'master-service',
    jwt_secret: 'master-jwt',
    status: 'ACTIVE_HEALTHY',
    ...overrides,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// provisionReplica
// ─────────────────────────────────────────────────────────────────────────────

describe('provisionReplica', () => {
  it('creates a replica with role=replica and correct rank', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const master = await makeMaster()
    const { provisionReplica } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const replicaRef = await provisionReplica(master.ref)
    const replica = getStoredProjectByRef(replicaRef)

    expect(replica!.role).toBe('replica')
    expect(replica!.replica_rank).toBe(1)
    expect(replica!.cluster_id).toBe(master.ref)
  })

  it('assigns incremental ranks for multiple replicas', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce({ kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545 })
      .mockReturnValueOnce({ kongHttpPort: 8300, kongHttpsPort: 8301, postgresPort: 5435, poolerPort: 6546 })
      .mockReturnValue({ kongHttpPort: 8400, kongHttpsPort: 8401, postgresPort: 5436, poolerPort: 6547 })

    const master = await makeMaster()
    const { provisionReplica } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const ref1 = await provisionReplica(master.ref)
    const ref2 = await provisionReplica(master.ref)
    const ref3 = await provisionReplica(master.ref)

    expect(getStoredProjectByRef(ref1)!.replica_rank).toBe(1)
    expect(getStoredProjectByRef(ref2)!.replica_rank).toBe(2)
    expect(getStoredProjectByRef(ref3)!.replica_rank).toBe(3)
  })

  it('inherits master JWT/anon/service keys', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const master = await makeMaster({ jwt_secret: 'jwt-xyz', anon_key: 'anon-xyz', service_key: 'svc-xyz' })
    const { provisionReplica } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const replicaRef = await provisionReplica(master.ref)
    const replica = getStoredProjectByRef(replicaRef)

    expect(replica!.jwt_secret).toBe('jwt-xyz')
    expect(replica!.anon_key).toBe('anon-xyz')
    expect(replica!.service_key).toBe('svc-xyz')
  })

  it('sets cluster_id on master when first replica is added', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const master = await makeMaster()
    expect(master.cluster_id).toBeUndefined()

    const { provisionReplica } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    await provisionReplica(master.ref)
    const updatedMaster = getStoredProjectByRef(master.ref)
    expect(updatedMaster!.cluster_id).toBe(master.ref)
  })

  it('reuses existing cluster_id from master', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce({ kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545 })
      .mockReturnValue({ kongHttpPort: 8300, kongHttpsPort: 8301, postgresPort: 5435, poolerPort: 6546 })

    const master = await makeMaster()
    const { provisionReplica } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const ref1 = await provisionReplica(master.ref)
    const ref2 = await provisionReplica(master.ref)

    expect(getStoredProjectByRef(ref1)!.cluster_id).toBe(master.ref)
    expect(getStoredProjectByRef(ref2)!.cluster_id).toBe(master.ref)
  })

  it('throws if project not found', async () => {
    const { provisionReplica } = await import('./clusterManager')
    await expect(provisionReplica('ghost')).rejects.toThrow('not found')
  })

  it('throws if provisioning a replica for a replica', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200,
      kongHttpsPort: 8201,
      postgresPort: 5434,
      poolerPort: 6545,
    })

    const master = await makeMaster()
    const { provisionReplica } = await import('./clusterManager')
    const { updateProjectFields } = await import('./projectsStore')

    const replicaRef = await provisionReplica(master.ref)
    updateProjectFields(replicaRef, { role: 'replica' })

    await expect(provisionReplica(replicaRef)).rejects.toThrow('Cannot provision a replica for a replica')
  })

  it('throws if provisioning a replica for a standby', async () => {
    const { updateProjectFields } = await import('./projectsStore')
    const master = await makeMaster()
    updateProjectFields(master.ref, { role: 'standby' })

    const { provisionReplica } = await import('./clusterManager')
    await expect(provisionReplica(master.ref)).rejects.toThrow('Cannot provision a replica for a standby')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// deprovisionReplica
// ─────────────────────────────────────────────────────────────────────────────

describe('deprovisionReplica', () => {
  it('deletes replica from registry', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545,
    })

    const master = await makeMaster()
    const { provisionReplica, deprovisionReplica } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    const replicaRef = await provisionReplica(master.ref)
    await deprovisionReplica(master.ref, replicaRef)

    expect(getStoredProjectByRef(replicaRef)).toBeUndefined()
  })

  it('calls dropReplicationSlot', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545,
    })

    const master = await makeMaster()
    const { provisionReplica, deprovisionReplica } = await import('./clusterManager')
    const repl = await import('./replicationManager')

    const replicaRef = await provisionReplica(master.ref)
    await deprovisionReplica(master.ref, replicaRef)

    expect(repl.dropReplicationSlot).toHaveBeenCalledWith(master.ref, replicaRef)
  })

  it('throws if replica not found', async () => {
    const master = await makeMaster()
    const { deprovisionReplica } = await import('./clusterManager')
    await expect(deprovisionReplica(master.ref, 'ghost-replica')).rejects.toThrow('not found')
  })

  it('throws if replica does not belong to master cluster', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce({ kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545 })
      .mockReturnValue({ kongHttpPort: 8300, kongHttpsPort: 8301, postgresPort: 5435, poolerPort: 6546 })

    const master1 = await makeMaster({ name: 'cluster-1' })
    const master2 = await makeMaster({ name: 'cluster-2' })
    const { provisionReplica, deprovisionReplica } = await import('./clusterManager')

    const replicaOfM2 = await provisionReplica(master2.ref)
    await expect(deprovisionReplica(master1.ref, replicaOfM2)).rejects.toThrow(
      'does not belong to cluster'
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// triggerClusterFailover
// ─────────────────────────────────────────────────────────────────────────────

describe('triggerClusterFailover', () => {
  async function setupMasterWithReplicas(count: number) {
    const orch = await import('./orchestrator')
    const mocks = Array.from({ length: count }, (_, i) => ({
      kongHttpPort: 8200 + i * 100,
      kongHttpsPort: 8201 + i * 100,
      postgresPort: 5434 + i,
      poolerPort: 6545 + i,
    }))
    // Extra call for replacement replica provisioned after failover
    mocks.push({ kongHttpPort: 8900, kongHttpsPort: 8901, postgresPort: 5499, poolerPort: 6599 })
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce(mocks[0])
      .mockReturnValueOnce(mocks[1] ?? mocks[0])
      .mockReturnValueOnce(mocks[2] ?? mocks[0])
      .mockReturnValue(mocks[mocks.length - 1])

    const master = await makeMaster()
    const { provisionReplica } = await import('./clusterManager')
    const { updateProjectStatus } = await import('./projectsStore')

    const replicaRefs: string[] = []
    for (let i = 0; i < count; i++) {
      const ref = await provisionReplica(master.ref)
      updateProjectStatus(ref, 'ACTIVE_HEALTHY')
      replicaRefs.push(ref)
    }

    return { master, replicaRefs }
  }

  it('promotes rank-1 replica when master fails', async () => {
    const { master, replicaRefs } = await setupMasterWithReplicas(2)
    const { triggerClusterFailover } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    await triggerClusterFailover(master.ref)

    const promotedMaster = getStoredProjectByRef(master.ref)
    // rank-1 replica's port should now be on master
    expect(promotedMaster!.kong_http_port).toBe(8200)
    void replicaRefs
  })

  it('increments failover_count', async () => {
    const { master } = await setupMasterWithReplicas(1)
    const { triggerClusterFailover } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    await triggerClusterFailover(master.ref)

    expect(getStoredProjectByRef(master.ref)!.failover_count).toBe(1)
  })

  it('removes promoted replica from registry', async () => {
    const { master, replicaRefs } = await setupMasterWithReplicas(2)
    const { triggerClusterFailover } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    await triggerClusterFailover(master.ref)

    // rank-1 replica absorbed into master
    expect(getStoredProjectByRef(replicaRefs[0])).toBeUndefined()
    // rank-2 replica still exists but now ranked 1
    const remaining = getStoredProjectByRef(replicaRefs[1])
    expect(remaining).toBeDefined()
    expect(remaining!.replica_rank).toBe(1)
  })

  it('re-ranks remaining replicas filling the gap', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce({ kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545 })
      .mockReturnValueOnce({ kongHttpPort: 8300, kongHttpsPort: 8301, postgresPort: 5435, poolerPort: 6546 })
      .mockReturnValueOnce({ kongHttpPort: 8400, kongHttpsPort: 8401, postgresPort: 5436, poolerPort: 6547 })
      .mockReturnValue({ kongHttpPort: 8900, kongHttpsPort: 8901, postgresPort: 5499, poolerPort: 6599 })

    const master = await makeMaster()
    const { provisionReplica, triggerClusterFailover } = await import('./clusterManager')
    const { updateProjectStatus, getStoredProjectByRef } = await import('./projectsStore')

    const r1 = await provisionReplica(master.ref)
    const r2 = await provisionReplica(master.ref)
    const r3 = await provisionReplica(master.ref)
    updateProjectStatus(r1, 'ACTIVE_HEALTHY')
    updateProjectStatus(r2, 'ACTIVE_HEALTHY')
    updateProjectStatus(r3, 'ACTIVE_HEALTHY')

    await triggerClusterFailover(master.ref)

    // r1 (rank 1) is promoted; r2 → rank 1, r3 → rank 2
    expect(getStoredProjectByRef(r1)).toBeUndefined()
    expect(getStoredProjectByRef(r2)!.replica_rank).toBe(1)
    expect(getStoredProjectByRef(r3)!.replica_rank).toBe(2)
  })

  it('calls promoteStandby on the promoted replica', async () => {
    const { master } = await setupMasterWithReplicas(1)
    const repl = await import('./replicationManager')
    const { triggerClusterFailover } = await import('./clusterManager')

    await triggerClusterFailover(master.ref)

    expect(repl.promoteStandby).toHaveBeenCalledOnce()
  })

  it('marks master INACTIVE if no healthy replicas exist', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts).mockReturnValue({
      kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545,
    })

    const master = await makeMaster()
    const { provisionReplica, triggerClusterFailover } = await import('./clusterManager')
    const { updateProjectStatus, getStoredProjectByRef } = await import('./projectsStore')

    const replicaRef = await provisionReplica(master.ref)
    // Replica is INACTIVE — not a candidate
    updateProjectStatus(replicaRef, 'INACTIVE')

    await triggerClusterFailover(master.ref)

    expect(getStoredProjectByRef(master.ref)!.status).toBe('INACTIVE')
  })

  it('marks master INACTIVE if cluster has no replicas at all', async () => {
    const master = await makeMaster()
    const { updateProjectFields } = await import('./projectsStore')
    updateProjectFields(master.ref, { cluster_id: master.ref })

    const { triggerClusterFailover } = await import('./clusterManager')
    const { getStoredProjectByRef } = await import('./projectsStore')

    await triggerClusterFailover(master.ref)

    expect(getStoredProjectByRef(master.ref)!.status).toBe('INACTIVE')
  })

  it('throws if master project does not exist', async () => {
    const { triggerClusterFailover } = await import('./clusterManager')
    await expect(triggerClusterFailover('ghost')).rejects.toThrow('not found')
  })

  it('only promotes ACTIVE_HEALTHY replicas, ignores INACTIVE', async () => {
    const orch = await import('./orchestrator')
    vi.mocked(orch.allocateNextPorts)
      .mockReturnValueOnce({ kongHttpPort: 8200, kongHttpsPort: 8201, postgresPort: 5434, poolerPort: 6545 })
      .mockReturnValueOnce({ kongHttpPort: 8300, kongHttpsPort: 8301, postgresPort: 5435, poolerPort: 6546 })
      .mockReturnValue({ kongHttpPort: 8900, kongHttpsPort: 8901, postgresPort: 5499, poolerPort: 6599 })

    const master = await makeMaster()
    const { provisionReplica, triggerClusterFailover } = await import('./clusterManager')
    const { updateProjectStatus, getStoredProjectByRef } = await import('./projectsStore')

    const r1 = await provisionReplica(master.ref) // rank 1
    const r2 = await provisionReplica(master.ref) // rank 2
    updateProjectStatus(r1, 'INACTIVE') // rank 1 down
    updateProjectStatus(r2, 'ACTIVE_HEALTHY') // rank 2 healthy

    await triggerClusterFailover(master.ref)

    const promoted = getStoredProjectByRef(master.ref)
    // rank-2 replica (port 8300) promoted instead of rank-1
    expect(promoted!.kong_http_port).toBe(8300)
    expect(promoted!.status).toBe('ACTIVE_HEALTHY')
  })
})
