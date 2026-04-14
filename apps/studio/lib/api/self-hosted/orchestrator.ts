/**
 * Docker orchestration for multi-head Supabase projects.
 *
 * Each project beyond the default gets its own isolated Docker Compose stack
 * launched from the same docker-compose.yml template but with a unique project
 * name (-p flag) and unique ports.
 *
 * A modified copy of docker-compose.yml is generated at startup with:
 *   - container_name: entries removed (so multiple stacks can coexist)
 *   - ./volumes/db/data bind mount replaced by a named volume (auto-prefixed by -p)
 *   - Other ./volumes/ bind mounts made absolute (pointing to the source docker/ dir)
 *
 * Environment variables:
 *   SUPABASE_COMPOSE_FILE   Path to the docker-compose.yml template
 *                           (defaults to ../../docker/docker-compose.yml relative to cwd)
 *   STUDIO_DATA_DIR         Where to write stack data (defaults to .studio-data/)
 *   MULTI_HEAD_HOST         Hostname reachable from inside the pg-meta container
 *                           Use "localhost" for native Studio, "host.docker.internal" for Docker
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// ────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────

const DATA_DIR = process.env.STUDIO_DATA_DIR || path.join(process.cwd(), '.studio-data')
const STACKS_DIR = path.join(DATA_DIR, 'stacks')

/** docker-compose.yml used as a template for new stacks */
const SOURCE_COMPOSE_FILE =
  process.env.SUPABASE_COMPOSE_FILE ||
  path.resolve(process.cwd(), '../../docker/docker-compose.yml')

/** Modified compose file written once into DATA_DIR */
const MULTI_HEAD_COMPOSE_FILE = path.join(DATA_DIR, 'docker-compose.multi-head.yml')

/**
 * Hostname by which other stacks' supavisor ports are reachable from inside
 * the default pg-meta container.
 *   - Native (no Docker): "localhost"
 *   - Docker on Mac/Win:  "host.docker.internal"  (automatic)
 *   - Docker on Linux:    "host.docker.internal"  (needs --add-host in Studio container)
 *                         or the Docker bridge IP, e.g. "172.17.0.1"
 */
const MULTI_HEAD_HOST = process.env.MULTI_HEAD_HOST || 'localhost'

// Port bases from the primary (default) stack
const DEFAULT_KONG_HTTP_PORT = parseInt(process.env.KONG_HTTP_PORT || '8000', 10)
const DEFAULT_KONG_HTTPS_PORT = parseInt(process.env.KONG_HTTPS_PORT || '8443', 10)
const DEFAULT_POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10)
const DEFAULT_POOLER_PORT = parseInt(process.env.POOLER_PROXY_PORT_TRANSACTION || '6543', 10)

/** Gap between each stack's port group */
const PORT_INCREMENT = 10

// ────────────────────────────────────────────────────────────
// JWT generation (no jsonwebtoken dependency — pure crypto)
// ────────────────────────────────────────────────────────────

function toBase64Url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeJwt(payload: Record<string, unknown>, secret: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = toBase64Url(JSON.stringify(payload))
  const sig = toBase64Url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest()
  )
  return `${header}.${body}.${sig}`
}

// ────────────────────────────────────────────────────────────
// Credentials
// ────────────────────────────────────────────────────────────

export interface ProjectCredentials {
  postgresPassword: string
  jwtSecret: string
  anonKey: string
  serviceKey: string
  dashboardPassword: string
  secretKeyBase: string
  vaultEncKey: string
  logflarePublicToken: string
  logflarePrivateToken: string
  s3AccessKeyId: string
  s3AccessKeySecret: string
  poolerTenantId: string
}

export function generateProjectCredentials(): ProjectCredentials {
  const postgresPassword = crypto.randomBytes(24).toString('base64url')
  const jwtSecret = crypto.randomBytes(32).toString('hex')

  const now = Math.floor(Date.now() / 1000)
  const exp = now + 10 * 365 * 24 * 3600 // 10-year keys

  const anonKey = makeJwt({ role: 'anon', iss: 'supabase', iat: now, exp }, jwtSecret)
  const serviceKey = makeJwt({ role: 'service_role', iss: 'supabase', iat: now, exp }, jwtSecret)

  return {
    postgresPassword,
    jwtSecret,
    anonKey,
    serviceKey,
    dashboardPassword: crypto.randomBytes(16).toString('hex'),
    secretKeyBase: crypto.randomBytes(32).toString('hex'),
    vaultEncKey: crypto.randomBytes(16).toString('hex'),
    logflarePublicToken: crypto.randomBytes(16).toString('hex'),
    logflarePrivateToken: crypto.randomBytes(16).toString('hex'),
    s3AccessKeyId: crypto.randomBytes(12).toString('hex'),
    s3AccessKeySecret: crypto.randomBytes(28).toString('hex'),
    poolerTenantId: crypto.randomBytes(8).toString('hex'),
  }
}

// ────────────────────────────────────────────────────────────
// Port allocation
// ────────────────────────────────────────────────────────────

export interface PortAllocation {
  kongHttpPort: number
  kongHttpsPort: number
  postgresPort: number
  poolerPort: number
}

/**
 * Scans running Docker Compose stacks whose name starts with "supabase-"
 * and returns the Kong HTTP host ports they have bound.
 */
export function getDockerStackKongPorts(): number[] {
  const ports: number[] = []
  try {
    const lsResult = spawnSync('docker', ['compose', 'ls', '--format', 'json', '--all'], {
      encoding: 'utf-8',
      timeout: 8000,
    })
    if (lsResult.error || lsResult.status !== 0) return ports
    const stacks = JSON.parse(lsResult.stdout.trim() || '[]') as Array<{ Name: string }>
    for (const stack of stacks) {
      if (!stack.Name.startsWith('supabase-')) continue
      const psResult = spawnSync(
        'docker',
        ['ps', '--filter', `name=${stack.Name}-kong`, '--format', '{{.Ports}}'],
        { encoding: 'utf-8', timeout: 5000 }
      )
      if (psResult.error || psResult.status !== 0) continue
      const match = psResult.stdout.match(/(?:0\.0\.0\.0:|:::)?(\d+)->8000\/tcp/)
      if (match) ports.push(parseInt(match[1], 10))
    }
  } catch {}
  return ports
}

/**
 * Given an array of currently-used Kong HTTP ports (from the store + Docker scan),
 * returns the next free port set for a new stack.
 */
export function allocateNextPorts(usedKongPorts: number[]): PortAllocation {
  const used = new Set([DEFAULT_KONG_HTTP_PORT, ...usedKongPorts])
  let kongPort = DEFAULT_KONG_HTTP_PORT + PORT_INCREMENT
  while (used.has(kongPort)) kongPort += PORT_INCREMENT
  const n = Math.round((kongPort - DEFAULT_KONG_HTTP_PORT) / PORT_INCREMENT)
  return {
    kongHttpPort: kongPort,
    kongHttpsPort: DEFAULT_KONG_HTTPS_PORT + n * PORT_INCREMENT,
    postgresPort: DEFAULT_POSTGRES_PORT + n * PORT_INCREMENT,
    poolerPort: DEFAULT_POOLER_PORT + n * PORT_INCREMENT,
  }
}

// ────────────────────────────────────────────────────────────
// Compose file preparation
// ────────────────────────────────────────────────────────────

/**
 * Generates (or refreshes) a multi-head-compatible docker-compose.yml in DATA_DIR.
 *
 * Transformations applied to the source compose file:
 *  1. All "container_name:" lines are removed — Docker Compose auto-names containers
 *     as <project>-<service>-<index>, so multiple stacks can coexist.
 *  2. The ./volumes/db/data bind mount is replaced with a named volume "db-data",
 *     which Docker Compose automatically scopes to the project (e.g. supabase-abc123_db-data).
 *  3. All remaining ./volumes/ references are made absolute, pointing to the
 *     source docker/ directory so all stacks share the read-only init scripts.
 *  4. "db-data:" is appended to the top-level volumes: section.
 *
 * Returns the path to the generated file.
 */
export function prepareMultiHeadComposeFile(): string {
  if (!fs.existsSync(SOURCE_COMPOSE_FILE)) {
    throw new Error(
      `Docker Compose template not found: ${SOURCE_COMPOSE_FILE}\n` +
        `Set SUPABASE_COMPOSE_FILE to the path of your docker-compose.yml.`
    )
  }

  const sourceDir = path.dirname(path.resolve(SOURCE_COMPOSE_FILE))
  const absVolumesDir = path.join(sourceDir, 'volumes').replace(/\\/g, '/')

  const lines = fs.readFileSync(SOURCE_COMPOSE_FILE, 'utf-8').split('\n')

  const transformed = lines
    // 1. Drop container_name lines
    .filter((line) => !line.trimStart().startsWith('container_name:'))
    .map((line) => {
      // 2. Replace ./volumes/db/data bind mount with named volume
      if (/^\s*-\s+\.\/volumes\/db\/data:/.test(line)) {
        const indent = line.match(/^(\s*)/)?.[1] ?? ''
        return `${indent}- db-data:/var/lib/postgresql/data:Z`
      }
      // 3. Make other ./volumes/ paths absolute
      return line.replace(/\.\/volumes\//g, `${absVolumesDir}/`)
    })

  // 4. Inject "db-data:" into the top-level volumes: section
  const volIdx = transformed.findIndex((l) => /^volumes:\s*$/.test(l))
  if (volIdx !== -1) {
    transformed.splice(volIdx + 1, 0, '  db-data:')
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(MULTI_HEAD_COMPOSE_FILE, transformed.join('\n'), 'utf-8')
  return MULTI_HEAD_COMPOSE_FILE
}

// ────────────────────────────────────────────────────────────
// Stack launch
// ────────────────────────────────────────────────────────────

export interface LaunchOptions {
  ref: string
  name: string
  ports: PortAllocation
  credentials: ProjectCredentials
}

/**
 * Writes a per-project .env file and launches a new Docker Compose stack.
 *
 * The stack name is "supabase-{ref}". All containers are auto-named with that
 * prefix (no container_name: conflicts). Data volumes are project-scoped.
 *
 * Returns the public URL (Kong HTTP) for this project.
 *
 * Throws if PG_META_CRYPTO_KEY is not set in Studio's environment (required so
 * the default pg-meta can decrypt x-connection-encrypted headers for this project).
 */
export async function launchProjectStack(opts: LaunchOptions): Promise<string> {
  const { ref, name, ports, credentials } = opts

  const pgMetaCryptoKey = process.env.PG_META_CRYPTO_KEY
  if (!pgMetaCryptoKey) {
    throw new Error(
      'PG_META_CRYPTO_KEY must be configured in Studio\'s environment to create multi-head projects. ' +
        'It must match the CRYPTO_KEY used by your default pg-meta service.'
    )
  }

  const composeFile = prepareMultiHeadComposeFile()

  const stackDir = path.join(STACKS_DIR, ref)
  fs.mkdirSync(stackDir, { recursive: true })

  const publicUrl = `http://${MULTI_HEAD_HOST}:${ports.kongHttpPort}`

  const envContent = [
    `# Auto-generated — project: ${name}  ref: ${ref}`,
    `POSTGRES_HOST=db`,
    `POSTGRES_DB=postgres`,
    `POSTGRES_PORT=${ports.postgresPort}`,
    `POSTGRES_PASSWORD=${credentials.postgresPassword}`,
    `POOLER_PROXY_PORT_TRANSACTION=${ports.poolerPort}`,
    `POOLER_TENANT_ID=${credentials.poolerTenantId}`,
    `POOLER_DEFAULT_POOL_SIZE=20`,
    `POOLER_MAX_CLIENT_CONN=100`,
    `POOLER_DB_POOL_SIZE=5`,
    `JWT_SECRET=${credentials.jwtSecret}`,
    `ANON_KEY=${credentials.anonKey}`,
    `SERVICE_ROLE_KEY=${credentials.serviceKey}`,
    `KONG_HTTP_PORT=${ports.kongHttpPort}`,
    `KONG_HTTPS_PORT=${ports.kongHttpsPort}`,
    `PG_META_CRYPTO_KEY=${pgMetaCryptoKey}`,
    `SUPABASE_PUBLIC_URL=${publicUrl}`,
    `API_EXTERNAL_URL=${publicUrl}`,
    `SITE_URL=http://localhost:3000`,
    `ADDITIONAL_REDIRECT_URLS=`,
    `JWT_EXPIRY=3600`,
    `DISABLE_SIGNUP=false`,
    `ENABLE_EMAIL_SIGNUP=true`,
    `ENABLE_EMAIL_AUTOCONFIRM=false`,
    `SMTP_ADMIN_EMAIL=admin@example.com`,
    `SMTP_HOST=supabase-mail`,
    `SMTP_PORT=2500`,
    `SMTP_USER=fake_mail_user`,
    `SMTP_PASS=fake_mail_password`,
    `SMTP_SENDER_NAME=fake_sender`,
    `ENABLE_ANONYMOUS_USERS=false`,
    `ENABLE_PHONE_SIGNUP=true`,
    `ENABLE_PHONE_AUTOCONFIRM=true`,
    `MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify`,
    `MAILER_URLPATHS_INVITE=/auth/v1/verify`,
    `MAILER_URLPATHS_RECOVERY=/auth/v1/verify`,
    `MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify`,
    `DASHBOARD_USERNAME=supabase`,
    `DASHBOARD_PASSWORD=${credentials.dashboardPassword}`,
    `STUDIO_DEFAULT_ORGANIZATION=${name}`,
    `STUDIO_DEFAULT_PROJECT=${name}`,
    `OPENAI_API_KEY=`,
    `PGRST_DB_SCHEMAS=public,storage,graphql_public`,
    `PGRST_DB_MAX_ROWS=1000`,
    `PGRST_DB_EXTRA_SEARCH_PATH=public`,
    `SECRET_KEY_BASE=${credentials.secretKeyBase}`,
    `VAULT_ENC_KEY=${credentials.vaultEncKey}`,
    `LOGFLARE_PUBLIC_ACCESS_TOKEN=${credentials.logflarePublicToken}`,
    `LOGFLARE_PRIVATE_ACCESS_TOKEN=${credentials.logflarePrivateToken}`,
    `S3_PROTOCOL_ACCESS_KEY_ID=${credentials.s3AccessKeyId}`,
    `S3_PROTOCOL_ACCESS_KEY_SECRET=${credentials.s3AccessKeySecret}`,
    `GLOBAL_S3_BUCKET=stub`,
    `REGION=stub`,
    `MINIO_ROOT_USER=supa-storage`,
    `MINIO_ROOT_PASSWORD=secret1234`,
    `STORAGE_TENANT_ID=${ref}`,
    `DOCKER_SOCKET_LOCATION=/var/run/docker.sock`,
    `GOOGLE_PROJECT_ID=`,
    `GOOGLE_PROJECT_NUMBER=`,
    `FUNCTIONS_VERIFY_JWT=false`,
    `SUPABASE_PUBLISHABLE_KEY=`,
    `SUPABASE_SECRET_KEY=`,
    `ANON_KEY_ASYMMETRIC=`,
    `SERVICE_ROLE_KEY_ASYMMETRIC=`,
    `JWT_KEYS=`,
    `JWT_JWKS=`,
    `IMGPROXY_AUTO_WEBP=true`,
  ].join('\n')

  const envFile = path.join(stackDir, '.env')
  fs.writeFileSync(envFile, envContent, 'utf-8')

  const projectName = `supabase-${ref}`
  const result = spawnSync(
    'docker',
    ['compose', '-p', projectName, '--env-file', envFile, '-f', composeFile, 'up', '-d', '--remove-orphans'],
    { encoding: 'utf-8', timeout: 180_000, stdio: 'pipe' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`docker compose up failed:\n${result.stderr || result.stdout}`)
  }

  return publicUrl
}

// ────────────────────────────────────────────────────────────
// Health check
// ────────────────────────────────────────────────────────────

/**
 * Polls the project's REST endpoint until Kong + Auth are responding,
 * or throws after timeoutMs.
 *
 * 401 is accepted as "healthy" (auth is up but the request lacks an API key).
 */
export async function waitForProjectHealth(
  publicUrl: string,
  timeoutMs = 180_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${publicUrl}/rest/v1/`, {
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok || res.status === 401) return
    } catch {}
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(
    `Project at ${publicUrl} did not become healthy within ${Math.round(timeoutMs / 1000)}s`
  )
}

// ────────────────────────────────────────────────────────────
// Stack teardown
// ────────────────────────────────────────────────────────────

/**
 * Stops and removes a Docker Compose stack (containers + named volumes).
 * The project's stack .env file in DATA_DIR/stacks/{ref}/ is also removed.
 *
 * Errors are swallowed so a missing / already-stopped stack doesn't fail deletion.
 */
export async function teardownProjectStack(ref: string, dockerProject: string): Promise<void> {
  const composeFile = MULTI_HEAD_COMPOSE_FILE
  const stackDir = path.join(STACKS_DIR, ref)
  const envFile = path.join(stackDir, '.env')

  try {
    const args = ['compose', '-p', dockerProject]
    if (fs.existsSync(composeFile)) args.push('-f', composeFile)
    if (fs.existsSync(envFile)) args.push('--env-file', envFile)
    args.push('down', '--volumes', '--remove-orphans')

    spawnSync('docker', args, { encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' })
  } catch {
    // best-effort — don't block deletion if docker is unreachable
  }

  try {
    if (fs.existsSync(stackDir)) fs.rmSync(stackDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

// ────────────────────────────────────────────────────────────
// Discovery
// ────────────────────────────────────────────────────────────

/**
 * Returns the Kong HTTP ports used by any running "supabase-*" Docker stacks.
 * Useful to avoid port conflicts when allocating ports for a new project.
 */
export function discoverDockerStackPorts(): number[] {
  return getDockerStackKongPorts()
}
