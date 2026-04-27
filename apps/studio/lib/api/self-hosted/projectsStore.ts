import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_PROJECT } from '@/lib/constants/api'
import { getStoredOrganizationBySlug } from './organizationsStore'

/**
 * On-disk project record.
 *
 * Two schemas coexist for backward compatibility:
 *
 * Legacy (manually-specified connection):
 *   db_host, db_port, db_user, db_name are present
 *   postgres_port / kong_http_port / docker_project are absent
 *
 * Current (Docker-orchestrated):
 *   postgres_port, kong_http_port, docker_project are present
 *   db_host / db_port / db_user / db_name are absent
 */
export interface StoredProject {
  id: number
  ref: string
  name: string
  organization_id: number
  organization_slug: string
  cloud_provider: string
  status: string
  region: string
  inserted_at: string
  public_url: string
  db_password: string
  anon_key: string
  service_key: string
  jwt_secret: string

  // Docker-orchestrated fields (new schema)
  postgres_port?: number
  kong_http_port?: number
  docker_project?: string
  pooler_port?: number
  pooler_tenant_id?: string

  // Legacy manual-connection fields (old schema)
  db_host?: string
  db_port?: number
  db_user?: string
  db_name?: string

  // Failover fields
  role?: 'primary' | 'standby'
  standby_ref?: string
  primary_ref?: string
  failure_streak?: number
  failover_count?: number
  last_failover_at?: string
}

const DATA_DIR =
  process.env.STUDIO_DATA_DIR || path.join(process.cwd(), '.studio-data')
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')

function readFromDisk(): StoredProject[] {
  try {
    if (!fs.existsSync(PROJECTS_FILE)) return []
    return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

function writeToDisk(projects: StoredProject[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8')
}

/** Returns a virtual DEFAULT_PROJECT entry built from env vars. Never persisted. */
function makeDefaultEntry(): StoredProject {
  return {
    id: DEFAULT_PROJECT.id,
    ref: DEFAULT_PROJECT.ref,
    name: DEFAULT_PROJECT.name,
    organization_id: DEFAULT_PROJECT.organization_id,
    organization_slug: 'default-org-slug',
    cloud_provider: DEFAULT_PROJECT.cloud_provider,
    status: DEFAULT_PROJECT.status,
    region: DEFAULT_PROJECT.region,
    inserted_at: DEFAULT_PROJECT.inserted_at,
    public_url: process.env.SUPABASE_PUBLIC_URL || 'http://localhost:8000',
    postgres_port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    kong_http_port: parseInt(process.env.KONG_HTTP_PORT || '8000', 10),
    pooler_port: parseInt(process.env.POOLER_PROXY_PORT_TRANSACTION || '6543', 10),
    pooler_tenant_id: process.env.POOLER_TENANT_ID || '',
    docker_project: 'supabase',
    db_password: process.env.POSTGRES_PASSWORD || 'postgres',
    anon_key: process.env.SUPABASE_ANON_KEY || '',
    service_key: process.env.SUPABASE_SERVICE_KEY || '',
    jwt_secret: process.env.AUTH_JWT_SECRET || '',
  }
}

/**
 * Returns all projects: the default (always first, built from env vars) plus any
 * additional projects persisted to disk.
 */
export function getStoredProjects(): StoredProject[] {
  return [makeDefaultEntry(), ...readFromDisk()]
}

export function getStoredProjectByRef(ref: string): StoredProject | undefined {
  return getStoredProjects().find((p) => p.ref === ref)
}

export interface CreateProjectData {
  name: string
  organization_slug?: string
  public_url: string
  postgres_port: number
  kong_http_port: number
  pooler_port: number
  pooler_tenant_id: string
  docker_project: string
  db_password: string
  anon_key: string
  service_key: string
  jwt_secret: string
  status?: string
}

/**
 * Data for importing an externally-managed Supabase stack.
 * Does not spawn any Docker containers — just registers the project for browsing.
 *
 * Two connection modes:
 *  - Same-host Docker stack: provide kong_http_port + optional postgres_port/pooler_port
 *  - Remote/external host:   provide db_host + db_port + db_user + db_name
 */
export interface ImportProjectData {
  name: string
  organization_slug?: string
  public_url: string
  db_password: string
  anon_key: string
  service_key: string
  jwt_secret: string

  // Same-host Docker stack fields
  kong_http_port?: number
  postgres_port?: number
  pooler_port?: number
  pooler_tenant_id?: string
  docker_project?: string

  // Remote/external host fields
  db_host?: string
  db_port?: number
  db_user?: string
  db_name?: string
}

export function createStoredProject(data: CreateProjectData): StoredProject {
  const existing = readFromDisk()
  const all = getStoredProjects()
  const id = Math.max(...all.map((p) => p.id), 0) + 1
  const ref = crypto.randomBytes(6).toString('hex')

  const orgSlug = data.organization_slug ?? 'default-org-slug'
  const org = getStoredOrganizationBySlug(orgSlug)
  const orgId = org?.id ?? 1

  const project: StoredProject = {
    id,
    ref,
    name: data.name,
    organization_id: orgId,
    organization_slug: orgSlug,
    cloud_provider: 'localhost',
    status: data.status ?? 'COMING_UP',
    region: 'local',
    inserted_at: new Date().toISOString(),
    public_url: data.public_url,
    postgres_port: data.postgres_port,
    kong_http_port: data.kong_http_port,
    pooler_port: data.pooler_port,
    pooler_tenant_id: data.pooler_tenant_id,
    docker_project: data.docker_project,
    db_password: data.db_password,
    anon_key: data.anon_key,
    service_key: data.service_key,
    jwt_secret: data.jwt_secret,
  }

  writeToDisk([...existing, project])
  return project
}

/**
 * Registers an existing Supabase stack without launching anything.
 * The project appears in the dashboard immediately with ACTIVE_HEALTHY status.
 */
export function importStoredProject(data: ImportProjectData): StoredProject {
  const existing = readFromDisk()
  const all = getStoredProjects()
  const id = Math.max(...all.map((p) => p.id), 0) + 1
  const ref = crypto.randomBytes(6).toString('hex')

  const importOrgSlug = data.organization_slug ?? 'default-org-slug'
  const importOrg = getStoredOrganizationBySlug(importOrgSlug)

  const project: StoredProject = {
    id,
    ref,
    name: data.name,
    organization_id: importOrg?.id ?? 1,
    organization_slug: importOrgSlug,
    cloud_provider: 'localhost',
    status: 'ACTIVE_HEALTHY',
    region: 'local',
    inserted_at: new Date().toISOString(),
    public_url: data.public_url,
    db_password: data.db_password,
    anon_key: data.anon_key,
    service_key: data.service_key,
    jwt_secret: data.jwt_secret,
    // Docker-orchestrated fields (same-host)
    ...(data.kong_http_port !== undefined && { kong_http_port: data.kong_http_port }),
    ...(data.postgres_port !== undefined && { postgres_port: data.postgres_port }),
    ...(data.pooler_port !== undefined && { pooler_port: data.pooler_port }),
    ...(data.pooler_tenant_id !== undefined && { pooler_tenant_id: data.pooler_tenant_id }),
    ...(data.docker_project !== undefined && { docker_project: data.docker_project }),
    // Legacy direct-connection fields (remote host)
    ...(data.db_host !== undefined && { db_host: data.db_host }),
    ...(data.db_port !== undefined && { db_port: data.db_port }),
    ...(data.db_user !== undefined && { db_user: data.db_user }),
    ...(data.db_name !== undefined && { db_name: data.db_name }),
  }

  writeToDisk([...existing, project])
  return project
}

export function updateProjectStatus(ref: string, status: string): void {
  const existing = readFromDisk()
  const updated = existing.map((p) => (p.ref === ref ? { ...p, status } : p))
  writeToDisk(updated)
}

export function updateStoredProjectField<K extends keyof StoredProject>(
  ref: string,
  field: K,
  value: StoredProject[K]
): void {
  const existing = readFromDisk()
  const updated = existing.map((p) => (p.ref === ref ? { ...p, [field]: value } : p))
  writeToDisk(updated)
}

export function deleteStoredProject(ref: string): void {
  const existing = readFromDisk()
  writeToDisk(existing.filter((p) => p.ref !== ref))
}

export function updateProjectFields(ref: string, patch: Partial<StoredProject>): void {
  const existing = readFromDisk()
  const updated = existing.map((p) => (p.ref === ref ? { ...p, ...patch } : p))
  writeToDisk(updated)
}
