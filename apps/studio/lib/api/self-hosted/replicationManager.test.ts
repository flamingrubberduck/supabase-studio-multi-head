// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock spawnSync so no Docker commands actually run
vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '', error: undefined })),
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

// orchestrator.ts uses spawnSync too but is a separate module — let it import real
vi.mock('./orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./orchestrator')>()
  return {
    ...actual,
    launchProjectStack: vi.fn(() => Promise.resolve()),
    teardownProjectStack: vi.fn(() => Promise.resolve()),
    waitForProjectHealth: vi.fn(() => Promise.resolve()),
    discoverDockerStackPorts: vi.fn(() => []),
  }
})

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smh-repl-test-'))
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

async function makePrimary(overrides: Record<string, unknown> = {}) {
  const { createStoredProject } = await import('./projectsStore')
  return createStoredProject({
    name: 'primary',
    organization_slug: 'default-org-slug',
    public_url: 'http://localhost:8100',
    postgres_port: 5433,
    kong_http_port: 8100,
    pooler_port: 6544,
    pooler_tenant_id: 'tenant-1',
    docker_project: 'supabase-primary',
    db_password: 'primary-pg-pass',
    anon_key: 'anon-key',
    service_key: 'service-key',
    jwt_secret: 'jwt-secret',
    status: 'ACTIVE_HEALTHY',
    ...overrides,
  })
}

async function makeStandby(overrides: Record<string, unknown> = {}) {
  const { createStoredProject } = await import('./projectsStore')
  return createStoredProject({
    name: 'standby',
    organization_slug: 'default-org-slug',
    public_url: 'http://localhost:8200',
    postgres_port: 5434,
    kong_http_port: 8200,
    pooler_port: 6545,
    pooler_tenant_id: 'tenant-2',
    docker_project: 'supabase-standby',
    db_password: 'standby-pg-pass',
    anon_key: 'anon-key',
    service_key: 'service-key',
    jwt_secret: 'jwt-secret',
    status: 'ACTIVE_HEALTHY',
    ...overrides,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// setupReplication
// ─────────────────────────────────────────────────────────────────────────────

describe('setupReplication', () => {
  it('throws if either project not found', async () => {
    const primary = await makePrimary()
    const { setupReplication } = await import('./replicationManager')

    await expect(setupReplication(primary.ref, 'nonexistent')).rejects.toThrow('Project not found')
    await expect(setupReplication('nonexistent', primary.ref)).rejects.toThrow('Project not found')
  })

  it('throws for the default project (no Docker named volume)', async () => {
    const standby = await makeStandby()
    const { setupReplication } = await import('./replicationManager')

    await expect(setupReplication('default', standby.ref)).rejects.toThrow(
      'WAL replication is not supported for the default project'
    )
  })

  it('throws if primary has no postgres_port', async () => {
    const { createStoredProject } = await import('./projectsStore')
    const primary = createStoredProject({
      name: 'no-port-primary',
      organization_slug: 'default-org-slug',
      public_url: 'http://localhost:8100',
      postgres_port: undefined as unknown as number,
      kong_http_port: 8100,
      pooler_port: 6544,
      pooler_tenant_id: 'tenant-1',
      docker_project: 'supabase-npp',
      db_password: 'pg',
      anon_key: 'ak',
      service_key: 'sk',
      jwt_secret: 'js',
    })
    const standby = await makeStandby()
    const { setupReplication } = await import('./replicationManager')

    await expect(setupReplication(primary.ref, standby.ref)).rejects.toThrow('no postgres_port')
  })

  it('throws if wal_level is minimal', async () => {
    const { spawnSync } = await import('node:child_process')

    // First call: pg_hba check → success
    // Second call: wal_level query → returns 'minimal'
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '', error: undefined } as ReturnType<typeof spawnSync>)
      .mockReturnValueOnce({ status: 0, stdout: 'minimal', stderr: '', error: undefined } as ReturnType<typeof spawnSync>)

    const primary = await makePrimary()
    const standby = await makeStandby()
    const { setupReplication } = await import('./replicationManager')

    await expect(setupReplication(primary.ref, standby.ref)).rejects.toThrow('wal_level=minimal')
  })

  it('throws and restarts standby DB if pg_basebackup fails', async () => {
    const { spawnSync } = await import('node:child_process')
    const calls: string[][] = []

    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      const argList = args as string[]
      calls.push(argList)

      // pg_basebackup call: contains 'run' and '--rm'
      if (argList.includes('run') && argList.includes('--rm')) {
        return { status: 1, stdout: '', stderr: 'basebackup error', error: undefined } as ReturnType<typeof spawnSync>
      }
      return { status: 0, stdout: 'replica', stderr: '', error: undefined } as ReturnType<typeof spawnSync>
    })

    const primary = await makePrimary()
    const standby = await makeStandby()
    const { setupReplication } = await import('./replicationManager')

    await expect(setupReplication(primary.ref, standby.ref)).rejects.toThrow('pg_basebackup failed')

    // After failure, should call 'start' on standby DB to recover
    const startCall = calls.find((a) => a.includes('start') && a.includes('db'))
    expect(startCall).toBeDefined()
  })

  it('creates replication slot with correct slot name', async () => {
    const { spawnSync } = await import('node:child_process')
    const sqlCalls: string[] = []

    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      const argList = args as string[]
      if (argList.includes('-c')) {
        const sqlIdx = argList.indexOf('-c')
        if (sqlIdx >= 0) sqlCalls.push(argList[sqlIdx + 1])
      }
      return { status: 0, stdout: 'replica', stderr: '', error: undefined } as ReturnType<typeof spawnSync>
    })

    const primary = await makePrimary()
    const standby = await makeStandby()
    const { setupReplication } = await import('./replicationManager')

    await setupReplication(primary.ref, standby.ref)

    const slotCreation = sqlCalls.find((sql) => sql.includes('pg_create_physical_replication_slot'))
    expect(slotCreation).toContain(`standby_${standby.ref}`)
  })

  it('stops standby DB before basebackup, starts it after', async () => {
    const { spawnSync } = await import('node:child_process')
    const dbActions: string[] = []

    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      const argList = args as string[]
      if (argList.includes('db') && (argList.includes('stop') || argList.includes('start'))) {
        dbActions.push(argList.includes('stop') ? 'stop' : 'start')
      }
      return { status: 0, stdout: 'replica', stderr: '', error: undefined } as ReturnType<typeof spawnSync>
    })

    const primary = await makePrimary()
    const standby = await makeStandby()
    const { setupReplication } = await import('./replicationManager')

    await setupReplication(primary.ref, standby.ref)

    expect(dbActions).toContain('stop')
    expect(dbActions).toContain('start')
    // stop must come before start
    expect(dbActions.indexOf('stop')).toBeLessThan(dbActions.indexOf('start'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// promoteStandby
// ─────────────────────────────────────────────────────────────────────────────

describe('promoteStandby', () => {
  it('calls pg_promote on standby DB', async () => {
    const { spawnSync } = await import('node:child_process')
    const sqlCalls: string[] = []

    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      const argList = args as string[]
      if (argList.includes('-c')) {
        const idx = argList.indexOf('-c')
        if (idx >= 0) sqlCalls.push(argList[idx + 1])
      }
      return { status: 0, stdout: 't', stderr: '', error: undefined } as ReturnType<typeof spawnSync>
    })

    const standby = await makeStandby()
    const { promoteStandby } = await import('./replicationManager')

    await promoteStandby(standby.ref)

    expect(sqlCalls.some((sql) => sql.includes('pg_promote'))).toBe(true)
  })

  it('does not throw if pg_promote returns error (non-standby warning)', async () => {
    const { spawnSync } = await import('node:child_process')
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'ERROR: not in standby mode',
      error: undefined,
    } as ReturnType<typeof spawnSync>)

    const standby = await makeStandby()
    const { promoteStandby } = await import('./replicationManager')

    // Should warn but not throw
    await expect(promoteStandby(standby.ref)).resolves.toBeUndefined()
  })

  it('throws if standby project not found', async () => {
    const { promoteStandby } = await import('./replicationManager')
    await expect(promoteStandby('ghost-ref')).rejects.toThrow('not found')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// dropReplicationSlot
// ─────────────────────────────────────────────────────────────────────────────

describe('dropReplicationSlot', () => {
  it('calls pg_drop_replication_slot with correct slot name', async () => {
    const { spawnSync } = await import('node:child_process')
    const sqlCalls: string[] = []

    vi.mocked(spawnSync).mockImplementation((_cmd, args) => {
      const argList = args as string[]
      if (argList.includes('-c')) {
        const idx = argList.indexOf('-c')
        if (idx >= 0) sqlCalls.push(argList[idx + 1])
      }
      return { status: 0, stdout: '', stderr: '', error: undefined } as ReturnType<typeof spawnSync>
    })

    const primary = await makePrimary()
    const { dropReplicationSlot } = await import('./replicationManager')

    dropReplicationSlot(primary.ref, 'replica-abc')

    const dropCall = sqlCalls.find((sql) => sql.includes('pg_drop_replication_slot'))
    expect(dropCall).toContain('standby_replica-abc')
  })

  it('is a no-op if primary project not found (silent fail)', async () => {
    const { spawnSync } = await import('node:child_process')
    const { dropReplicationSlot } = await import('./replicationManager')

    // Should not throw even though project doesn't exist
    expect(() => dropReplicationSlot('ghost-primary', 'replica-abc')).not.toThrow()
    expect(spawnSync).not.toHaveBeenCalled()
  })

  it('warns but does not throw if drop query fails', async () => {
    const { spawnSync } = await import('node:child_process')
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'slot not found',
      error: undefined,
    } as ReturnType<typeof spawnSync>)

    const primary = await makePrimary()
    const { dropReplicationSlot } = await import('./replicationManager')

    expect(() => dropReplicationSlot(primary.ref, 'replica-abc')).not.toThrow()
  })
})
