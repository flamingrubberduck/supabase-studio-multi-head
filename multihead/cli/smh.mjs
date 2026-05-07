#!/usr/bin/env node
/**
 * smh — Supabase Multi-Head CLI
 *
 * Talks to the self-hosted projects API exposed by Studio.
 *
 * Usage:
 *   smh list
 *   smh create <name>
 *   smh rename <ref> <name>
 *   smh delete <ref>
 *   smh start  <ref>
 *   smh stop   <ref>
 *   smh status <ref>
 *   smh health [ref]
 *
 *   smh org list
 *   smh org create <name>
 *   smh org rename <slug> <name>
 *
 *   smh member list   <org-slug>
 *   smh member add    <org-slug> <email> --role <role> [--password <pw>]
 *   smh member remove <org-slug> <gotrue_id>
 *
 *   smh replica add    <ref> [--host <docker_host>]
 *   smh replica remove <ref> <replica_ref>
 *
 *   smh standby add    <ref> [--host <docker_host>]
 *   smh standby remove <ref>
 *
 *   smh failover         <ref>   # primary → standby
 *   smh cluster-failover <ref>   # cluster master → highest-rank healthy replica
 *
 *   smh backup list <ref>
 *   smh backup run <ref>
 *   smh backup schedule <ref> daily|weekly|off
 *   smh backup restore <ref> <filename> --confirm
 *   smh backup delete <ref> <filename>
 *   smh backup download <ref> <filename> [--out <path>]
 *
 *   smh migrate <ref> --source <db-url> [--schemas <s1,s2>] [--schema-only]
 *   smh migrate resume <ref> <job-id>
 *
 *   smh license status
 *   smh license activate <key>
 *   smh license deactivate
 *
 *   smh overlay                          list optional component profiles
 *
 * Environment:
 *   STUDIO_URL          Base URL of Studio (default: http://localhost:8000)
 *   DASHBOARD_USERNAME  Basic auth username
 *   DASHBOARD_PASSWORD  Basic auth password
 */

// ── helpers ──────────────────────────────────────────────────────────────────

const BASE    = (process.env.STUDIO_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const PLAT    = `${BASE}/api/platform/projects`
const API     = PLAT
const ORG_API = `${BASE}/api/platform/organizations`
const LIC_API = `${BASE}/api/platform/license`

function basicAuthHeader() {
  const user = process.env.DASHBOARD_USERNAME
  const pass = process.env.DASHBOARD_PASSWORD
  if (!user || !pass) return null
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

async function request(method, url, body, { allowNonOk = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const auth = basicAuthHeader()
  if (auth) headers['Authorization'] = auth
  const opts = { method, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)
  let res
  try {
    res = await fetch(url, opts)
  } catch (err) {
    die(`Cannot reach Studio at ${BASE} — is it running?\n  ${err.message}`)
  }
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok && !allowNonOk) {
    const msg = data?.error?.message ?? data?.message ?? JSON.stringify(data)
    die(`HTTP ${res.status}: ${msg}`)
  }
  return { status: res.status, data }
}

const api  = (m, path, body, opts) =>
  request(m, `${API}${path}`, body, opts).then(r => r.data)
const plat = (m, ref, sub, body, opts) =>
  request(m, `${PLAT}/${ref}${sub}`, body, opts)
const orgReq = (m, path, body, opts) =>
  request(m, `${ORG_API}${path}`, body, opts)

function die(msg) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`)
  process.exit(1)
}

function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`)
}

function parseFlag(args, flag) {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : undefined
}

// ── formatters ───────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  active:   '\x1b[32m',
  creating: '\x1b[33m',
  stopped:  '\x1b[90m',
  error:    '\x1b[31m',
}
function colorStatus(s) { return `${STATUS_COLOR[s] ?? ''}${s}\x1b[0m` }

const HEALTH_COLOR = {
  running:     '\x1b[32m✓\x1b[0m',
  stopped:     '\x1b[33m●\x1b[0m',
  'not found': '\x1b[31m✗\x1b[0m',
}
function colorHealth(s) { return `${HEALTH_COLOR[s] ?? s} ${s}` }

function printTable(rows, cols) {
  const widths = cols.map(c => c.label.length)
  for (const row of rows) {
    cols.forEach((c, i) => {
      const val = String((c.fmt ? c.fmt(row[c.key]) : row[c.key]) ?? '')
      const plain = val.replace(/\x1b\[[0-9;]*m/g, '')
      if (plain.length > widths[i]) widths[i] = plain.length
    })
  }
  const pad = (s, w) => {
    const plain = s.replace(/\x1b\[[0-9;]*m/g, '')
    return s + ' '.repeat(Math.max(0, w - plain.length))
  }
  console.log(`\x1b[1m${cols.map((c, i) => pad(c.label, widths[i])).join('  ')}\x1b[0m`)
  console.log(widths.map(w => '─'.repeat(w)).join('  '))
  for (const row of rows) {
    console.log(cols.map((c, i) => {
      const val = String((c.fmt ? c.fmt(row[c.key]) : row[c.key]) ?? '')
      return pad(val, widths[i])
    }).join('  '))
  }
}

// ── project commands ──────────────────────────────────────────────────────────

async function cmdList() {
  const projects = await api('GET', '')
  if (!projects.length) { console.log('No projects.'); return }
  printTable(projects, [
    { key: 'ref',        label: 'REF' },
    { key: 'name',       label: 'NAME' },
    { key: 'status',     label: 'STATUS',   fmt: colorStatus },
    { key: 'ports',      label: 'DB PORT',  fmt: p => p?.db  ?? '—' },
    { key: 'ports',      label: 'API PORT', fmt: p => p?.meta ?? '—' },
    { key: 'insertedAt', label: 'CREATED',  fmt: s => s ? new Date(s).toLocaleDateString() : '—' },
  ])
}

async function cmdCreate(name) {
  if (!name) die('Usage: smh create <name>')
  console.log(`Creating project "${name}"…`)
  const p = await api('POST', '', { name })
  ok(`Created  ref=${p.ref}  status=${p.status}`)
  console.log(`  DB port:   ${p.ports.db}`)
  console.log(`  API port:  ${p.ports.meta}`)
  console.log(`  Anon key:  ${p.anonKey}`)
}

async function cmdRename(ref, name) {
  if (!ref || !name) die('Usage: smh rename <ref> <name>')
  const { status, data } = await plat('PATCH', ref, '', { name }, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`Renamed project ${ref} → "${data.name}"`)
}

async function cmdDelete(ref) {
  if (!ref) die('Usage: smh delete <ref>')
  const { message } = await api('DELETE', `/${ref}`)
  ok(message)
}

async function cmdStart(ref) {
  if (!ref) die('Usage: smh start <ref>')
  const { message } = await api('POST', `/${ref}/start`)
  ok(message)
}

async function cmdStop(ref) {
  if (!ref) die('Usage: smh stop <ref>')
  const { message } = await api('POST', `/${ref}/stop`)
  ok(message)
}

async function cmdStatus(ref) {
  if (!ref) die('Usage: smh status <ref>')
  const p = await api('GET', `/${ref}`)
  console.log(`ref:        ${p.ref}`)
  console.log(`name:       ${p.name}`)
  console.log(`status:     ${colorStatus(p.status)}`)
  console.log(`metaUrl:    ${p.metaUrl}`)
  console.log(`authUrl:    ${p.authUrl}`)
  console.log(`restUrl:    ${p.restUrl}`)
  console.log(`db host:    ${p.db.host}:${p.db.port}`)
  console.log(`anonKey:    ${p.anonKey}`)
  console.log(`created:    ${p.insertedAt}`)
}

async function cmdHealth(ref) {
  if (ref) {
    const h = await api('GET', `/${ref}/health`, undefined, { allowNonOk: true })
    console.log(`ref:     ${h.ref}`)
    console.log(`overall: ${h.overall}`)
    console.log(`  db:    ${colorHealth(h.db)}`)
    console.log(`  meta:  ${colorHealth(h.meta)}`)
    console.log(`  rest:  ${colorHealth(h.rest)}`)
    console.log(`  auth:  ${colorHealth(h.auth)}`)
  } else {
    const projects = await api('GET', '')
    if (!projects.length) { console.log('No projects.'); return }
    const rows = projects.map(p => ({
      ref: p.ref, name: p.name,
      overall: p.health?.overall ?? '—',
      db: p.health?.db ?? '—', meta: p.health?.meta ?? '—',
      rest: p.health?.rest ?? '—', auth: p.health?.auth ?? '—',
    }))
    printTable(rows, [
      { key: 'ref',     label: 'REF' },
      { key: 'name',    label: 'NAME' },
      { key: 'overall', label: 'OVERALL' },
      { key: 'db',      label: 'DB',   fmt: colorHealth },
      { key: 'meta',    label: 'META', fmt: colorHealth },
      { key: 'rest',    label: 'REST', fmt: colorHealth },
      { key: 'auth',    label: 'AUTH', fmt: colorHealth },
    ])
  }
}

// ── org commands ──────────────────────────────────────────────────────────────

async function cmdOrgList() {
  const { status, data } = await orgReq('GET', '', undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  const orgs = data
  if (!orgs.length) { console.log('No organizations.'); return }
  printTable(orgs, [
    { key: 'slug', label: 'SLUG' },
    { key: 'name', label: 'NAME' },
  ])
}

async function cmdOrgCreate(name) {
  if (!name) die('Usage: smh org create <name>')
  const { status, data } = await orgReq('POST', '', { name }, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`Created organization  slug=${data.slug}  name="${data.name}"`)
}

async function cmdOrgRename(slug, name) {
  if (!slug || !name) die('Usage: smh org rename <slug> <name>')
  const { status, data } = await orgReq('PATCH', `/${slug}`, { name }, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`Renamed organization ${slug} → "${data.name}"`)
}

// ── member commands ───────────────────────────────────────────────────────────

const ROLE_NAMES = { owner: 1, administrator: 2, developer: 3, readonly: 4 }

async function cmdMemberList(slug) {
  if (!slug) die('Usage: smh member list <org-slug>')
  const { status, data } = await orgReq('GET', `/${slug}/members`, undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  const members = data
  if (!members.length) { console.log('No members.'); return }
  const ROLE_LABEL = { 1: 'Owner', 2: 'Administrator', 3: 'Developer', 4: 'Read-only' }
  printTable(members, [
    { key: 'gotrue_id',     label: 'ID' },
    { key: 'primary_email', label: 'EMAIL' },
    { key: 'role_ids',      label: 'ROLE', fmt: ids => {
      const base = ids?.find(id => id < 1000) ?? ids?.[0]
      return ROLE_LABEL[base] ?? String(base)
    }},
  ])
}

async function cmdMemberAdd(slug, email, args) {
  if (!slug || !email) die('Usage: smh member add <org-slug> <email> --role <role> [--password <pw>]')
  const roleName = parseFlag(args, '--role')?.toLowerCase().replace('-', '')
  const password = parseFlag(args, '--password')
  const role_id = ROLE_NAMES[roleName]
  if (!role_id) die(`--role must be one of: owner, administrator, developer, readonly`)
  const body = { email, role_id, ...(password && { password }) }
  const { status, data } = await orgReq('POST', `/${slug}/members/invitations`, body, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`Added member  id=${data.gotrue_id}  email=${data.primary_email}`)
}

async function cmdMemberRemove(slug, gotrueId) {
  if (!slug || !gotrueId) die('Usage: smh member remove <org-slug> <gotrue_id>')
  const { status, data } = await orgReq('DELETE', `/${slug}/members/${gotrueId}`, undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(data?.message ?? 'Member removed')
}

// ── oauth-urls command ────────────────────────────────────────────────────────

async function cmdOauthUrls(ref) {
  if (ref) {
    const p = await api('GET', `/${ref}`)
    const base = p.authUrl ?? p.public_url?.replace(/\/$/, '')
    if (!base) die(`No auth URL found for project ${ref}`)
    console.log(`\x1b[1m${p.name}\x1b[0m  (${p.ref})`)
    console.log(`  Callback URL:  ${base}/callback`)
    console.log(`  Site URL:      ${p.public_url ?? '—'}`)
    console.log(`\nAdd this callback URL to every OAuth provider's allowed redirect list.`)
  } else {
    const projects = await api('GET', '')
    if (!projects.length) { console.log('No projects.'); return }
    printTable(
      projects.map(p => {
        const base = p.authUrl ?? p.public_url?.replace(/\/$/, '')
        return { ref: p.ref, name: p.name, callback: base ? `${base}/callback` : '—' }
      }),
      [
        { key: 'ref',      label: 'REF' },
        { key: 'name',     label: 'NAME' },
        { key: 'callback', label: 'OAUTH CALLBACK URL' },
      ]
    )
    console.log('\nRegister each callback URL in your OAuth provider (Google, GitHub, etc.).')
  }
}

// ── storage command ───────────────────────────────────────────────────────────

async function cmdStorage(ref) {
  if (ref) {
    const p = await api('GET', `/${ref}`)
    const base = p.public_url?.replace(/\/$/, '')
    console.log(`\x1b[1m${p.name}\x1b[0m  (${p.ref})`)
    console.log(`  Storage API:   ${base ? `${base}/storage/v1` : '—'}`)
    console.log(`  Storage URL (for clients): ${base ? `${base}/storage/v1/object/public/<bucket>/<file>` : '—'}`)
    console.log(`\nTo add a CDN, put a reverse proxy in front of the storage URL above.`)
  } else {
    const projects = await api('GET', '')
    if (!projects.length) { console.log('No projects.'); return }
    printTable(
      projects.map(p => {
        const base = p.public_url?.replace(/\/$/, '')
        return { ref: p.ref, name: p.name, storage: base ? `${base}/storage/v1` : '—' }
      }),
      [
        { key: 'ref',     label: 'REF' },
        { key: 'name',    label: 'NAME' },
        { key: 'storage', label: 'STORAGE API URL' },
      ]
    )
  }
}

// ── migrations commands ───────────────────────────────────────────────────────

async function cmdMigrations(ref) {
  if (!ref) die('Usage: smh migrations <ref>')
  const { status, data } = await plat('GET', ref, '/migrations', undefined, { allowNonOk: true })
  if (status === 404) die(`Project not found: ${ref}`)
  if (!String(status).startsWith('2')) die(data?.error?.message ?? JSON.stringify(data))
  const { migrations } = data
  if (!migrations.length) {
    console.log(`No migrations applied on project ${ref}.`)
    return
  }
  printTable(migrations, [
    { key: 'version', label: 'VERSION' },
    { key: 'name',    label: 'NAME', fmt: s => s ?? '—' },
  ])
  console.log(`\n${migrations.length} migration(s) applied.`)
}

async function cmdMigrationsCompare() {
  const projects = await api('GET', '')
  if (projects.length < 2) { console.log('Need at least 2 projects to compare.'); return }

  // Fetch migrations for all projects in parallel
  const results = await Promise.all(
    projects.map(async p => {
      try {
        const { status, data } = await plat('GET', p.ref, '/migrations', undefined, { allowNonOk: true })
        if (!String(status).startsWith('2')) return { ref: p.ref, name: p.name, versions: new Set(), error: true }
        return { ref: p.ref, name: p.name, versions: new Set((data.migrations ?? []).map(m => m.version)), error: false }
      } catch {
        return { ref: p.ref, name: p.name, versions: new Set(), error: true }
      }
    })
  )

  // Union of all versions across all projects
  const allVersions = [...new Set(results.flatMap(r => [...r.versions]))].sort()

  if (!allVersions.length) {
    console.log('No migrations found in any project.')
    return
  }

  // Header row
  const cols = [
    { key: 'version', label: 'VERSION' },
    ...results.map(r => ({ key: r.ref, label: r.name.slice(0, 16), ref: r.ref })),
  ]

  const rows = allVersions.map(v => {
    const row = { version: v }
    for (const r of results) {
      row[r.ref] = r.error ? '\x1b[33m?\x1b[0m' : r.versions.has(v) ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
    }
    return row
  })

  printTable(rows, cols)

  // Summarize divergence
  const diverged = allVersions.filter(v =>
    results.some(r => !r.error && r.versions.has(v)) &&
    results.some(r => !r.error && !r.versions.has(v))
  )
  if (diverged.length) {
    console.log(`\n\x1b[33mWarning:\x1b[0m ${diverged.length} migration(s) not applied on all projects.`)
  } else {
    console.log(`\n\x1b[32m✓\x1b[0m All projects are in sync (${allVersions.length} migration(s)).`)
  }
}

// ── replica commands ──────────────────────────────────────────────────────────

async function cmdReplicaAdd(ref, dockerHost) {
  if (!ref) die('Usage: smh replica add <ref> [--host <docker_host>]')
  console.log(`Provisioning replica for ${ref}…`)
  const body = dockerHost ? { docker_host: dockerHost } : {}
  const { status, data } = await plat('POST', ref, '/replica', body, { allowNonOk: true })
  if (status === 402) die(`License required: ${data?.error?.message ?? data?.message}`)
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`Replica provisioning started  replica_ref=${data.replica_ref}`)
  console.log(`  Status: ${data.status}`)
  console.log(`  ${data.message}`)
  console.log(`\nPoll with: smh status ${data.replica_ref}`)
}

async function cmdReplicaRemove(ref, replicaRef) {
  if (!ref || !replicaRef) die('Usage: smh replica remove <ref> <replica_ref>')
  const { status, data } = await plat('DELETE', ref, `/replica?replica_ref=${replicaRef}`, undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(data.message ?? 'Replica removed')
}

// ── standby commands ──────────────────────────────────────────────────────────

async function cmdStandbyAdd(ref, dockerHost) {
  if (!ref) die('Usage: smh standby add <ref> [--host <docker_host>]')
  console.log(`Provisioning standby for ${ref}…`)
  const body = dockerHost ? { docker_host: dockerHost } : {}
  const { status, data } = await plat('POST', ref, '/standby', body, { allowNonOk: true })
  if (status === 402) die(`License required: ${data?.error?.message ?? data?.message}`)
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`Standby provisioning started  standby_ref=${data.standby_ref}`)
  console.log(`  Status: ${data.status}`)
  console.log(`  ${data.message}`)
  console.log(`\nPoll with: smh status ${data.standby_ref}`)
}

async function cmdStandbyRemove(ref) {
  if (!ref) die('Usage: smh standby remove <ref>')
  const { status, data } = await plat('DELETE', ref, '/standby', undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(data.message ?? 'Standby removed')
}

// ── failover commands ─────────────────────────────────────────────────────────

async function cmdFailover(ref) {
  if (!ref) die('Usage: smh failover <ref>')
  console.log(`Triggering failover for ${ref}…`)
  const { status, data } = await plat('POST', ref, '/failover', {}, { allowNonOk: true })
  if (status === 402) die(`License required: ${data?.error?.message ?? data?.message}`)
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok('Failover complete')
  console.log(`  New URL:        ${data.public_url}`)
  console.log(`  Status:         ${data.status}`)
  console.log(`  Failover count: ${data.failover_count}`)
  console.log(`  Last failover:  ${data.last_failover_at}`)
  console.log(`  ${data.message}`)
}

async function cmdClusterFailover(ref) {
  if (!ref) die('Usage: smh cluster-failover <ref>')
  console.log(`Triggering cluster failover for ${ref}…`)
  const { status, data } = await plat('POST', ref, '/cluster-failover', {}, { allowNonOk: true })
  if (status === 402) die(`License required: ${data?.error?.message ?? data?.message}`)
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok('Cluster failover complete')
  console.log(`  New URL: ${data.public_url}`)
}

// ── license commands ──────────────────────────────────────────────────────────

async function cmdLicenseStatus() {
  const { status, data } = await request('GET', LIC_API, undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  const TIER_COLOR = { enterprise: '\x1b[35m', business: '\x1b[32m' }
  const color = TIER_COLOR[data.tier] ?? '\x1b[33m'
  console.log(`tier:  ${color}${data.tier ?? 'free'}\x1b[0m`)
  if (data.email) console.log(`email: ${data.email}`)
  if (data.grace) console.log(`\x1b[33mWarning:\x1b[0m License server unreachable — running in grace period`)
}

async function cmdLicenseActivate(key) {
  if (!key) die('Usage: smh license activate <key>')
  const { status, data } = await request('PATCH', LIC_API, { key }, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`License activated — ${data.tier} tier`)
  if (data.email) console.log(`  Email: ${data.email}`)
}

async function cmdLicenseDeactivate() {
  const { status, data } = await request('DELETE', LIC_API, undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok('License deactivated — running as free tier')
}

// ── migrate command ───────────────────────────────────────────────────────────

async function cmdMigrate(sub, args) {
  // smh migrate resume <ref> <jobId>
  if (sub === 'resume') {
    const [ref, jobId] = args
    if (!ref || !jobId) die('Usage: smh migrate resume <ref> <job-id>')

    console.log(`Resuming migration ${jobId} for project ${ref}…\n`)

    const { status: s0, data: d0 } = await plat(
      'POST', ref, '/migrate',
      { action: 'resume', job_id: jobId },
      { allowNonOk: true }
    )
    if (!String(s0).startsWith('2')) die(d0?.error?.message ?? d0?.message ?? JSON.stringify(d0))

    await pollMigrationJob(ref, d0.job_id)
    return
  }

  // smh migrate <ref> --source <db-url> [--schemas …] [--schema-only]
  const ref = sub
  if (!ref) die('Usage: smh migrate <ref> --source <db-url> [--schemas public,auth] [--schema-only]')

  const sourceUrl = parseFlag(args, '--source')
  if (!sourceUrl) die('--source <db-url> is required.\n\n  Get it from: Project Settings → Database → Connection string → URI\n  Use the direct URL (db.<ref>.supabase.co), not the pooler.')

  const schemasArg = parseFlag(args, '--schemas') ?? 'public'
  const schemaOnly = args.includes('--schema-only')
  const schemas    = schemasArg.split(',').map(s => s.trim()).filter(Boolean)

  const masked = sourceUrl.replace(/:[^:@]+@/, ':****@')
  console.log(`Migrating to project ${ref}…`)
  console.log(`  Source:  ${masked}`)
  console.log(`  Schemas: ${schemas.join(', ')}`)
  console.log(`  Mode:    ${schemaOnly ? 'schema only' : 'schema + data'}`)
  console.log()

  const { status: s0, data: d0 } = await plat(
    'POST', ref, '/migrate',
    { source_db_url: sourceUrl, schemas, schema_only: schemaOnly },
    { allowNonOk: true }
  )
  if (!String(s0).startsWith('2')) die(d0?.error?.message ?? d0?.message ?? JSON.stringify(d0))

  await pollMigrationJob(ref, d0.job_id)
}

async function pollMigrationJob(ref, jobId) {
  let logOffset = 0

  for (;;) {
    await new Promise(r => setTimeout(r, 2000))

    const { status: s1, data: job } = await plat(
      'GET', ref, `/migrate?job=${jobId}`,
      undefined, { allowNonOk: true }
    )
    if (!String(s1).startsWith('2')) die(job?.error?.message ?? JSON.stringify(job))

    const newLines = (job.logs ?? []).slice(logOffset)
    for (const line of newLines) console.log(`  ${line}`)
    logOffset += newLines.length

    if (job.status === 'done') {
      console.log()
      ok('Migration completed successfully.')
      break
    }
    if (job.status === 'done-with-warnings') {
      console.log()
      console.warn(`\x1b[33mWarning:\x1b[0m Migration completed with ${job.restoreErrors} restore error(s).`)
      console.warn('Search the log above for "pg_restore: error:" to review them.')
      break
    }
    if (job.status === 'error') {
      console.log()
      die('Migration failed — see log above for details.')
    }
    if (job.status === 'interrupted') {
      console.log()
      die(`Migration was interrupted.\nTo resume: smh migrate resume ${ref} ${jobId}`)
    }
  }
}

// ── backup command ────────────────────────────────────────────────────────────

const BACKUP_API = `${BASE}/api/self-hosted/backups`

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleString()
}

async function backupReq(method, qs, body) {
  const url = `${BACKUP_API}${qs ?? ''}`
  const headers = { 'Content-Type': 'application/json' }
  const auth = basicAuthHeader()
  if (auth) headers['Authorization'] = auth
  const opts = { method, headers }
  if (body !== undefined) opts.body = JSON.stringify(body)
  let res
  try { res = await fetch(url, opts) }
  catch (err) { die(`Cannot reach Studio at ${BASE} — is it running?\n  ${err.message}`) }
  const text = await res.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) die(`HTTP ${res.status}: ${data?.error ?? JSON.stringify(data)}`)
  return data
}

async function cmdBackup(sub, args) {
  if (sub === 'list') {
    const ref = args[0]
    if (!ref) die('Usage: smh backup list <ref>')
    const { backups, schedule, lastRunAt } = await backupReq('GET', `?ref=${encodeURIComponent(ref)}`)
    console.log(`Schedule: \x1b[36m${schedule}\x1b[0m${lastRunAt ? `  (last run: ${fmtDate(lastRunAt)})` : ''}`)
    if (!backups.length) { console.log('No backups yet.'); return }
    console.log()
    printTable(backups, [
      { key: 'filename', label: 'FILENAME' },
      { key: 'createdAt', label: 'CREATED', fmt: fmtDate },
      { key: 'sizeBytes', label: 'SIZE', fmt: formatBytes },
    ])
    return
  }

  if (sub === 'run') {
    const ref = args[0]
    if (!ref) die('Usage: smh backup run <ref>')
    console.log(`Running backup for project ${ref}…`)
    const { backup } = await backupReq('POST', '', { ref, action: 'run' })
    ok(`Backup complete: ${backup.filename} (${formatBytes(backup.sizeBytes)})`)
    return
  }

  if (sub === 'schedule') {
    const [ref, sched] = args
    const valid = ['daily', 'weekly', 'off']
    if (!ref || !sched || !valid.includes(sched)) {
      die('Usage: smh backup schedule <ref> daily|weekly|off')
    }
    await backupReq('POST', '', { ref, action: 'schedule', schedule: sched })
    ok(`Backup schedule set to "${sched}" for project ${ref}.`)
    return
  }

  if (sub === 'restore') {
    const [ref, filename] = args
    if (!ref || !filename) die('Usage: smh backup restore <ref> <filename> --confirm')
    if (!args.includes('--confirm')) {
      die(`Restoring overwrites the live database. Re-run with --confirm to proceed:\n  smh backup restore ${ref} ${filename} --confirm`)
    }
    console.log(`Restoring ${filename} into project ${ref}…`)
    await backupReq('POST', '', { ref, action: 'restore', filename })
    ok('Database restored successfully.')
    return
  }

  if (sub === 'delete') {
    const [ref, filename] = args
    if (!ref || !filename) die('Usage: smh backup delete <ref> <filename>')
    const qs = `?ref=${encodeURIComponent(ref)}&filename=${encodeURIComponent(filename)}`
    await backupReq('DELETE', qs)
    ok(`Backup ${filename} deleted.`)
    return
  }

  if (sub === 'download') {
    const [ref, filename] = args
    if (!ref || !filename) die('Usage: smh backup download <ref> <filename> [--out <path>]')
    const outPath = parseFlag(args, '--out') ?? filename
    const url = `${BACKUP_API}/${encodeURIComponent(filename)}?ref=${encodeURIComponent(ref)}`
    const headers = {}
    const auth = basicAuthHeader()
    if (auth) headers['Authorization'] = auth
    let res
    try { res = await fetch(url, { headers }) }
    catch (err) { die(`Cannot reach Studio at ${BASE} — is it running?\n  ${err.message}`) }
    if (!res.ok) {
      const text = await res.text()
      let data; try { data = JSON.parse(text) } catch { data = text }
      die(`HTTP ${res.status}: ${data?.error ?? JSON.stringify(data)}`)
    }
    const { createWriteStream } = await import('node:fs')
    const writer = createWriteStream(outPath)
    process.stdout.write(`Downloading ${filename} → ${outPath}…`)
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
      ;(async () => {
        try {
          for await (const chunk of res.body) writer.write(chunk)
          writer.end()
        } catch (e) { reject(e) }
      })()
    })
    console.log(' done.')
    ok(`Saved to ${outPath}`)
    return
  }

  const valid = ['list', 'run', 'schedule', 'restore', 'delete', 'download']
  console.error(`Unknown backup sub-command: ${sub ?? '(none)'}`)
  console.error(`Valid: ${valid.join(', ')}`)
  process.exit(1)
}

// ── overlay command ───────────────────────────────────────────────────────────

const OPTIONAL_PROFILES = [
  { name: 'realtime',       desc: 'Realtime WebSocket subscriptions' },
  { name: 'storage',        desc: 'Storage API + imgproxy image transformations' },
  { name: 'edge-functions', desc: 'Edge Functions (Deno runtime)' },
  { name: 'pooler',         desc: 'Supavisor connection pooler (ports 5432 / 6543)' },
  { name: 'analytics',      desc: 'Logflare + Vector log pipeline' },
]

async function cmdOverlay(args) {
  // Profile names can be passed directly: smh overlay realtime storage
  // --run executes the generated command instead of just printing it
  const run      = args.includes('--run')
  const selected = args.filter(a => a !== '--run' && OPTIONAL_PROFILES.some(p => p.name === a))
  const unknown  = args.filter(a => a !== '--run' && !OPTIONAL_PROFILES.some(p => p.name === a))
  if (unknown.length) die(`Unknown profile(s): ${unknown.join(', ')}\nValid: ${OPTIONAL_PROFILES.map(p => p.name).join(', ')}`)

  console.log(`\x1b[1mOptional component profiles\x1b[0m  (docker-compose.minimal.yml)\n`)
  for (const p of OPTIONAL_PROFILES) {
    const active = selected.includes(p.name)
    const marker = active ? `\x1b[32m✓\x1b[0m` : ` `
    console.log(`  ${marker} \x1b[36m--profile ${p.name.padEnd(16)}\x1b[0m ${p.desc}`)
  }

  const hasProfiles = selected.length > 0
  const profilePart = selected.map(p => `  --profile ${p}`).join(' \\\n')

  const lines = [
    'docker compose \\',
    '  -f docker-compose.yml \\',
    '  -f docker-compose.minimal.yml \\',
    ...(hasProfiles ? [profilePart + ' \\'] : []),
    '  up -d',
  ]
  console.log('\n\x1b[1mCompose command:\x1b[0m\n')
  console.log(lines.join('\n'))

  if (!hasProfiles) {
    console.log('\n\x1b[2m# Core only. Pass profile names to enable optional components:\x1b[0m')
    console.log(`\x1b[2m# smh overlay ${OPTIONAL_PROFILES.map(p => p.name).join(' ')}\x1b[0m`)
  }

  if (run) {
    const { execSync } = await import('node:child_process')
    const profileFlags = selected.map(p => `--profile ${p}`).join(' ')
    console.log()
    execSync(
      `docker compose -f docker-compose.yml -f docker-compose.minimal.yml ${profileFlags} up -d`.trim(),
      { stdio: 'inherit' }
    )
  }
}

// ── usage ─────────────────────────────────────────────────────────────────────

function usage() {
  console.log(`
\x1b[1msmh\x1b[0m — Supabase Multi-Head CLI

\x1b[1mProject management:\x1b[0m
  smh list                             list all projects
  smh create <name>                    create a new project
  smh rename <ref> <name>              rename a project
  smh delete <ref>                     delete a project and its containers
  smh start  <ref>                     start a stopped project
  smh stop   <ref>                     stop a running project
  smh status <ref>                     show registry details for a project
  smh health [ref]                     show live container health

\x1b[1mOrganization management:\x1b[0m
  smh org list                         list all organizations
  smh org create <name>                create a new organization
  smh org rename <slug> <name>         rename an organization

\x1b[1mMember management:\x1b[0m
  smh member list   <org-slug>         list members of an organization
  smh member add    <org-slug> <email> --role <role> [--password <pw>]
  smh member remove <org-slug> <id>    remove a member

  Roles: owner | administrator | developer | readonly

\x1b[1mSetup helpers:\x1b[0m
  smh oauth-urls [ref]                 print GoTrue callback URLs to register with OAuth providers
  smh storage    [ref]                 print storage API URLs per project
  smh migrations <ref>                 list applied migrations on a project
  smh migrations compare               show migration state across all projects

\x1b[1mBackups:\x1b[0m
  smh backup list     <ref>                        list backups and schedule
  smh backup run      <ref>                        trigger a pg_dump backup now
  smh backup schedule <ref> daily|weekly|off       set automatic backup schedule
  smh backup restore  <ref> <filename> --confirm   restore database from a backup
  smh backup delete   <ref> <filename>             delete a backup file
  smh backup download <ref> <filename> [--out <path>]  download backup to local file

\x1b[1mMigrate from Supabase Cloud:\x1b[0m
  smh migrate <ref> --source <db-url>  dump cloud DB and restore into a self-hosted project
    [--schemas public,auth]            comma-separated schemas (default: public)
    [--schema-only]                    skip row data, migrate schema only
  smh migrate resume <ref> <job-id>    resume an interrupted migration (restore phase only)

\x1b[1mCluster (read replicas):\x1b[0m
  smh replica add    <ref> [--host H]  provision a read replica  [Business]
  smh replica remove <ref> <replica>   remove a read replica

\x1b[1mFailover (warm standby):\x1b[0m
  smh standby add    <ref> [--host H]  provision a warm standby  [Business]
  smh standby remove <ref>             remove the standby
  smh failover         <ref>           trigger primary → standby failover  [Business]
  smh cluster-failover <ref>           promote highest-rank healthy replica [Enterprise]

\x1b[1mLicense:\x1b[0m
  smh license status                   show current license tier
  smh license activate <key>           activate a license key
  smh license deactivate               revert to free tier

\x1b[1mOptional components (docker-compose.minimal.yml):\x1b[0m
  smh overlay                          list profiles and print compose command (core only)
  smh overlay <profile>...             list profiles with selected ones enabled + print command
  smh overlay <profile>... --run       also execute the compose command
  Profiles: realtime  storage  edge-functions  pooler  analytics

\x1b[1mEnvironment:\x1b[0m
  STUDIO_URL          Studio base URL  (default: http://localhost:8000)
  DASHBOARD_USERNAME  Basic auth username
  DASHBOARD_PASSWORD  Basic auth password
`.trim())
}

// ── main ──────────────────────────────────────────────────────────────────────

const [,, cmd, sub, ...rest] = process.argv

switch (cmd) {
  case 'list':             await cmdList();                break
  case 'create':           await cmdCreate(sub);           break
  case 'rename':           await cmdRename(sub, rest[0]);  break
  case 'delete':           await cmdDelete(sub);           break
  case 'start':            await cmdStart(sub);            break
  case 'stop':             await cmdStop(sub);             break
  case 'status':           await cmdStatus(sub);           break
  case 'health':           await cmdHealth(sub);           break
  case 'failover':         await cmdFailover(sub);         break
  case 'cluster-failover': await cmdClusterFailover(sub);  break
  case 'oauth-urls':       await cmdOauthUrls(sub);        break
  case 'storage':          await cmdStorage(sub);          break
  case 'backup':           await cmdBackup(sub, rest);     break
  case 'migrate':          await cmdMigrate(sub, rest);    break
  case 'overlay':          await cmdOverlay(sub ? [sub, ...rest] : []); break

  case 'migrations':
    if (!sub || sub === 'compare') await cmdMigrationsCompare()
    else                           await cmdMigrations(sub)
    break

  case 'org':
    if (sub === 'list')        await cmdOrgList()
    else if (sub === 'create') await cmdOrgCreate(rest[0])
    else if (sub === 'rename') await cmdOrgRename(rest[0], rest[1])
    else { console.error(`Unknown org sub-command: ${sub}`); usage(); process.exit(1) }
    break

  case 'member':
    if (sub === 'list')        await cmdMemberList(rest[0])
    else if (sub === 'add')    await cmdMemberAdd(rest[0], rest[1], rest.slice(2))
    else if (sub === 'remove') await cmdMemberRemove(rest[0], rest[1])
    else { console.error(`Unknown member sub-command: ${sub}`); usage(); process.exit(1) }
    break

  case 'replica':
    if (sub === 'add')         await cmdReplicaAdd(rest[0], parseFlag(rest.slice(1), '--host'))
    else if (sub === 'remove') await cmdReplicaRemove(rest[0], rest[1])
    else { console.error(`Unknown replica sub-command: ${sub}`); usage(); process.exit(1) }
    break

  case 'standby':
    if (sub === 'add')         await cmdStandbyAdd(rest[0], parseFlag(rest.slice(1), '--host'))
    else if (sub === 'remove') await cmdStandbyRemove(rest[0])
    else { console.error(`Unknown standby sub-command: ${sub}`); usage(); process.exit(1) }
    break

  case 'license':
    if (sub === 'status')          await cmdLicenseStatus()
    else if (sub === 'activate')   await cmdLicenseActivate(rest[0])
    else if (sub === 'deactivate') await cmdLicenseDeactivate()
    else { console.error(`Unknown license sub-command: ${sub}`); usage(); process.exit(1) }
    break

  default: usage(); process.exit(cmd ? 1 : 0)
}
