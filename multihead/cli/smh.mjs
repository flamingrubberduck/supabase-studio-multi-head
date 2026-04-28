#!/usr/bin/env node
/**
 * smh — Supabase Multi-Head CLI
 *
 * Talks to the self-hosted projects API exposed by Studio.
 *
 * Usage:
 *   smh list
 *   smh create <name>
 *   smh delete <ref>
 *   smh start  <ref>
 *   smh stop   <ref>
 *   smh status <ref>
 *   smh health [ref]
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
 *   smh license status
 *   smh license activate <key>
 *   smh license deactivate
 *
 * Environment:
 *   STUDIO_URL   Base URL of Studio (default: http://localhost:8082)
 */

// ── helpers ──────────────────────────────────────────────────────────────────

const BASE    = (process.env.STUDIO_URL ?? 'http://localhost:8082').replace(/\/$/, '')
const PLAT    = `${BASE}/api/platform/projects`
const API     = PLAT  // self-hosted projects live at the platform endpoint
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

function die(msg) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`)
  process.exit(1)
}

function ok(msg) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`)
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

// ── replica commands ──────────────────────────────────────────────────────────

async function cmdReplicaAdd(ref, dockerHost) {
  if (!ref) die('Usage: smh replica add <ref> [--host <docker_host>]')
  console.log(`Provisioning replica for ${ref}…`)
  const body = dockerHost ? { docker_host: dockerHost } : {}
  const { status, data } = await plat('POST', ref, '/replica', body, { allowNonOk: true })
  if (status === 402) die(`Pro license required: ${data?.error?.message ?? data?.message}`)
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
  if (status === 402) die(`Pro license required: ${data?.error?.message ?? data?.message}`)
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
  if (status === 402) die(`Pro license required: ${data?.error?.message ?? data?.message}`)
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
  if (status === 402) die(`Pro license required: ${data?.error?.message ?? data?.message}`)
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok('Cluster failover complete')
  console.log(`  New URL: ${data.public_url}`)
}

// ── license commands ──────────────────────────────────────────────────────────

async function cmdLicenseStatus() {
  const { status, data } = await request('GET', LIC_API, undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  const tier = data.tier === 'pro' ? '\x1b[32mpro\x1b[0m' : '\x1b[33mfree\x1b[0m'
  console.log(`tier:  ${tier}`)
  if (data.email) console.log(`email: ${data.email}`)
  if (data.grace) console.log(`\x1b[33mWarning:\x1b[0m License server unreachable — running in grace period`)
}

async function cmdLicenseActivate(key) {
  if (!key) die('Usage: smh license activate <key>')
  const { status, data } = await request('PATCH', LIC_API, { key }, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok(`License activated — ${data.tier ?? 'pro'} tier`)
  if (data.email) console.log(`  Email: ${data.email}`)
}

async function cmdLicenseDeactivate() {
  const { status, data } = await request('DELETE', LIC_API, undefined, { allowNonOk: true })
  if (!String(status).startsWith('2')) die(data?.error?.message ?? data?.message ?? JSON.stringify(data))
  ok('License deactivated — running as Free tier')
}

// ── usage ─────────────────────────────────────────────────────────────────────

function usage() {
  console.log(`
\x1b[1msmh\x1b[0m — Supabase Multi-Head CLI

\x1b[1mProject management:\x1b[0m
  smh list                             list all projects
  smh create <name>                    create a new project
  smh delete <ref>                     delete a project and its containers
  smh start  <ref>                     start a stopped project
  smh stop   <ref>                     stop a running project
  smh status <ref>                     show registry details for a project
  smh health [ref]                     show live container health

\x1b[1mCluster (read replicas):\x1b[0m
  smh replica add    <ref> [--host H]  provision a read replica  [Pro]
  smh replica remove <ref> <replica>   remove a read replica

\x1b[1mFailover (warm standby):\x1b[0m
  smh standby add    <ref> [--host H]  provision a warm standby  [Pro]
  smh standby remove <ref>             remove the standby
  smh failover         <ref>           trigger primary → standby failover  [Pro]
  smh cluster-failover <ref>           promote highest-rank healthy replica [Pro]

\x1b[1mLicense:\x1b[0m
  smh license status                   show current license tier
  smh license activate <key>           activate a Pro license key
  smh license deactivate               revert to Free tier

\x1b[1mEnvironment:\x1b[0m
  STUDIO_URL   Studio base URL  (default: http://localhost:8082)
`.trim())
}

// ── main ──────────────────────────────────────────────────────────────────────

const [,, cmd, sub, ...rest] = process.argv

function parseHost(args) {
  const idx = args.indexOf('--host')
  return idx >= 0 ? args[idx + 1] : undefined
}

switch (cmd) {
  case 'list':             await cmdList();                break
  case 'create':           await cmdCreate(sub);           break
  case 'delete':           await cmdDelete(sub);           break
  case 'start':            await cmdStart(sub);            break
  case 'stop':             await cmdStop(sub);             break
  case 'status':           await cmdStatus(sub);           break
  case 'health':           await cmdHealth(sub);           break
  case 'failover':         await cmdFailover(sub);         break
  case 'cluster-failover': await cmdClusterFailover(sub);  break

  case 'replica':
    if (sub === 'add')         await cmdReplicaAdd(rest[0], parseHost(rest.slice(1)))
    else if (sub === 'remove') await cmdReplicaRemove(rest[0], rest[1])
    else { console.error(`Unknown replica sub-command: ${sub}`); usage(); process.exit(1) }
    break

  case 'standby':
    if (sub === 'add')         await cmdStandbyAdd(rest[0], parseHost(rest.slice(1)))
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
