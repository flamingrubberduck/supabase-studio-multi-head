/**
 * Orchestrates Docker containers for self-hosted Supabase projects.
 * Creates db + meta + auth (GoTrue) per project.
 *
 * Only call this from server-side self-hosted code.
 */

import fs from 'fs'
import path from 'path'

import {
  connectContainerToNetwork,
  createContainer,
  createNetwork,
  createVolume,
  inspectContainer,
  removeContainer,
  removeVolume,
  startContainer,
  stopContainer,
} from './docker-client'
import {
  generateAnonKey,
  generateJwtSecret,
  generatePostgresPassword,
  generateServiceRoleKey,
} from './jwt-generator'
import {
  addProject,
  allocatePorts,
  getAllProjects,
  getProject,
  PROJECTS_DIR,
  removeProject,
  SelfHostedProject,
  updateProjectStatus,
} from './project-registry'

// Image versions kept in sync with docker/docker-compose.yml
const IMAGES = {
  db: 'supabase/postgres:15.8.1.085',
  meta: 'supabase/postgres-meta:v0.96.3',
  auth: 'supabase/gotrue:v2.186.0',
  rest: 'postgrest/postgrest:v14.8',
} as const

/** Shared Docker network that Studio and all project services join. */
const SHARED_NETWORK = 'supabase-projects'

const STUDIO_CONTAINER_NAME =
  process.env.STUDIO_CONTAINER_NAME ?? 'supabase-studio'

/** Whether Studio is running inside Docker (affects host resolution). */
function isRunningInDocker(): boolean {
  try {
    return fs.existsSync('/.dockerenv')
  } catch {
    return false
  }
}

function projectHost(): string {
  return isRunningInDocker() ? 'host.docker.internal' : 'localhost'
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function containerName(prefix: string, service: string): string {
  return `${prefix}-${service}`
}

function volumeName(prefix: string, service: string): string {
  return `supabase-${prefix}-${service}`
}

function networkName(prefix: string): string {
  return `supabase-${prefix}`
}

// ---- DB init SQL -------------------------------------------------------------
// Written to a temp dir and mounted into the postgres container on first start.
// These mirror the files in docker/volumes/db/ and are needed for Supabase schemas.

const JWT_SQL = (jwtSecret: string, jwtExp: number) => `
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO '${jwtSecret}';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO '${jwtExp}';
`

function writeInitScripts(prefix: string, jwtSecret: string): string {
  const dir = path.join(PROJECTS_DIR, prefix, 'db-init')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, '99-jwt.sql'), JWT_SQL(jwtSecret, 3600), 'utf-8')
  return dir
}

// ---- Container configs -------------------------------------------------------

function dbContainerConfig(
  prefix: string,
  ports: SelfHostedProject['ports'],
  dbPassword: string,
  jwtSecret: string
) {
  const initDir = writeInitScripts(prefix, jwtSecret)

  return {
    name: containerName(prefix, 'db'),
    image: IMAGES.db,
    env: {
      POSTGRES_PASSWORD: dbPassword,
      POSTGRES_DB: 'postgres',
      POSTGRES_HOST: '/var/run/postgresql',
      JWT_SECRET: jwtSecret,
      JWT_EXP: '3600',
    },
    networks: [networkName(prefix)],
    portBindings: { [ports.db]: 5432 },
    volumes: [
      { volumeName: volumeName(prefix, 'db'), containerPath: '/var/lib/postgresql/data' },
      { volumeName: `${volumeName(prefix, 'db-init')}`, containerPath: '' }, // unused — we use bind mount
    ],
    // bind-mount the init scripts via HostConfig.Binds (handled in createContainer)
    cmd: [
      'postgres',
      '-c',
      'config_file=/etc/postgresql/postgresql.conf',
      '-c',
      'log_min_messages=fatal',
    ],
  }
}

function metaContainerConfig(
  prefix: string,
  ports: SelfHostedProject['ports'],
  dbPassword: string,
  pgMetaCryptoKey: string
) {
  return {
    name: containerName(prefix, 'meta'),
    image: IMAGES.meta,
    env: {
      PG_META_PORT: '8080',
      PG_META_DB_HOST: containerName(prefix, 'db'),
      PG_META_DB_PORT: '5432',
      PG_META_DB_NAME: 'postgres',
      PG_META_DB_USER: 'supabase_admin',
      PG_META_DB_PASSWORD: dbPassword,
      CRYPTO_KEY: pgMetaCryptoKey,
    },
    networks: [networkName(prefix), SHARED_NETWORK],
    portBindings: { [ports.meta]: 8080 },
  }
}

function restContainerConfig(
  prefix: string,
  ports: SelfHostedProject['ports'],
  dbPassword: string,
  jwtSecret: string,
  exposedSchemas: string
) {
  return {
    name: containerName(prefix, 'rest'),
    image: IMAGES.rest,
    env: {
      PGRST_DB_URI: `postgres://authenticator:${dbPassword}@${containerName(prefix, 'db')}:5432/postgres`,
      PGRST_DB_SCHEMAS: exposedSchemas,
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_DB_USE_LEGACY_GUCS: 'false',
      PGRST_APP_SETTINGS_JWT_SECRET: jwtSecret,
      PGRST_APP_SETTINGS_JWT_EXP: '3600',
    },
    networks: [networkName(prefix), SHARED_NETWORK],
    portBindings: { [ports.rest]: 3000 },
    cmd: ['postgrest'],
  }
}

function authContainerConfig(
  prefix: string,
  ports: SelfHostedProject['ports'],
  dbPassword: string,
  jwtSecret: string,
  publicUrl: string
) {
  const dbUrl = `postgres://supabase_auth_admin:${dbPassword}@${containerName(prefix, 'db')}:5432/postgres`

  return {
    name: containerName(prefix, 'auth'),
    image: IMAGES.auth,
    env: {
      GOTRUE_API_HOST: '0.0.0.0',
      GOTRUE_API_PORT: '9999',
      API_EXTERNAL_URL: publicUrl,
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_DATABASE_URL: dbUrl,
      GOTRUE_SITE_URL: publicUrl,
      GOTRUE_URI_ALLOW_LIST: '',
      GOTRUE_DISABLE_SIGNUP: 'false',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_EXP: '3600',
      GOTRUE_JWT_SECRET: jwtSecret,
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
      // Auto-confirm emails so new projects work without SMTP config
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
    },
    networks: [networkName(prefix), SHARED_NETWORK],
    portBindings: { [ports.auth]: 9999 },
  }
}

// ---- Public API --------------------------------------------------------------

export async function createProject(name: string): Promise<SelfHostedProject> {
  const ref = slugify(name)

  if (ref.length < 3) throw new Error('Project name too short (min 3 characters after slugifying)')
  if (getProject(ref)) throw new Error(`A project with ref "${ref}" already exists`)

  const ports = allocatePorts()
  const prefix = ref
  const jwtSecret = generateJwtSecret()
  const dbPassword = generatePostgresPassword()
  const anonKey = generateAnonKey(jwtSecret)
  const serviceRoleKey = generateServiceRoleKey(jwtSecret)
  const pgMetaCryptoKey = generateJwtSecret() // reuse generator for random key
  const host = projectHost()

  const publicUrl = `http://${host}:${ports.auth}`

  const project = addProject({
    ref,
    name,
    status: 'creating',
    metaUrl: `http://${host}:${ports.meta}`,
    authUrl: publicUrl,
    restUrl: `http://${host}:${ports.rest}`,
    kongUrl: `http://${host}:${ports.kong}`,
    db: { host: containerName(prefix, 'db'), port: 5432, name: 'postgres', password: dbPassword },
    jwtSecret,
    anonKey,
    serviceRoleKey,
    insertedAt: new Date().toISOString(),
    containerPrefix: prefix,
    ports,
  })

  try {
    // 1. Ensure shared network exists and Studio is on it
    await createNetwork(SHARED_NETWORK)
    try {
      await connectContainerToNetwork(SHARED_NETWORK, STUDIO_CONTAINER_NAME)
    } catch {
      // Not fatal — Studio may already be connected or running outside Docker
    }

    // 2. Project-scoped network
    await createNetwork(networkName(prefix))

    // 3. Volumes
    await createVolume(volumeName(prefix, 'db'))

    // 4. db container
    const dbConfig = dbContainerConfig(prefix, ports, dbPassword, jwtSecret)
    await createContainer({
      ...dbConfig,
      volumes: [{ volumeName: volumeName(prefix, 'db'), containerPath: '/var/lib/postgresql/data' }],
    })
    await startContainer(containerName(prefix, 'db'))

    // 5. meta container
    await createContainer(metaContainerConfig(prefix, ports, dbPassword, pgMetaCryptoKey))
    await startContainer(containerName(prefix, 'meta'))

    // 6. rest (PostgREST) + auth (GoTrue) — both depend on db; start after db
    const exposedSchemas = process.env.PGRST_DB_SCHEMAS ?? 'public,storage,graphql_public'
    await createContainer(restContainerConfig(prefix, ports, dbPassword, jwtSecret, exposedSchemas))
    await createContainer(authContainerConfig(prefix, ports, dbPassword, jwtSecret, publicUrl))
    await startContainer(containerName(prefix, 'rest'))
    await startContainer(containerName(prefix, 'auth'))

    updateProjectStatus(ref, 'active')
    return { ...project, status: 'active' }
  } catch (err) {
    updateProjectStatus(ref, 'error')
    throw err
  }
}

export async function deleteProject(ref: string): Promise<void> {
  const project = getProject(ref)
  if (!project) throw new Error(`Project "${ref}" not found`)

  const { containerPrefix: prefix } = project

  await removeContainer(containerName(prefix, 'auth'))
  await removeContainer(containerName(prefix, 'rest'))
  await removeContainer(containerName(prefix, 'meta'))
  await removeContainer(containerName(prefix, 'db'))
  await removeVolume(volumeName(prefix, 'db'))

  removeProject(ref)
}

export async function startProject(ref: string): Promise<void> {
  const project = getProject(ref)
  if (!project) throw new Error(`Project "${ref}" not found`)

  const { containerPrefix: prefix } = project
  await startContainer(containerName(prefix, 'db'))
  await startContainer(containerName(prefix, 'meta'))
  await startContainer(containerName(prefix, 'rest'))
  await startContainer(containerName(prefix, 'auth'))
  updateProjectStatus(ref, 'active')
}

export async function stopProject(ref: string): Promise<void> {
  const project = getProject(ref)
  if (!project) throw new Error(`Project "${ref}" not found`)

  const { containerPrefix: prefix } = project
  await stopContainer(containerName(prefix, 'auth'))
  await stopContainer(containerName(prefix, 'rest'))
  await stopContainer(containerName(prefix, 'meta'))
  await stopContainer(containerName(prefix, 'db'))
  updateProjectStatus(ref, 'stopped')
}

export interface ProjectHealth {
  ref: string
  db: 'running' | 'stopped' | 'not found'
  meta: 'running' | 'stopped' | 'not found'
  rest: 'running' | 'stopped' | 'not found'
  auth: 'running' | 'stopped' | 'not found'
  overall: 'healthy' | 'degraded' | 'offline'
}

export async function getProjectHealth(ref: string): Promise<ProjectHealth> {
  const project = getProject(ref)
  if (!project) throw new Error(`Project "${ref}" not found`)

  const { containerPrefix: prefix } = project
  const [dbState, metaState, restState, authState] = await Promise.all([
    inspectContainer(containerName(prefix, 'db')),
    inspectContainer(containerName(prefix, 'meta')),
    inspectContainer(containerName(prefix, 'rest')),
    inspectContainer(containerName(prefix, 'auth')),
  ])

  const toStatus = (s: { exists: boolean; running: boolean }) =>
    !s.exists ? ('not found' as const) : s.running ? ('running' as const) : ('stopped' as const)

  const db = toStatus(dbState)
  const meta = toStatus(metaState)
  const rest = toStatus(restState)
  const auth = toStatus(authState)
  const services = [db, meta, rest, auth]
  const allRunning = services.every((s) => s === 'running')
  const noneRunning = services.every((s) => s !== 'running')

  return {
    ref,
    db,
    meta,
    rest,
    auth,
    overall: allRunning ? 'healthy' : noneRunning ? 'offline' : 'degraded',
  }
}

export async function getAllProjectsHealth(): Promise<ProjectHealth[]> {
  const projects = getAllProjects()
  return Promise.all(projects.map((p) => getProjectHealth(p.ref)))
}
