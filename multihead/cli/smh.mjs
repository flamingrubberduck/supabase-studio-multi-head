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
 *   smh status <ref>       # registry record
 *   smh health <ref>       # live container health
 *   smh health             # health of all projects
 *
 * Environment:
 *   STUDIO_URL   Base URL of Studio (default: http://localhost:8082)
 */

// ── helpers ──────────────────────────────────────────────────────────────────

const BASE = (process.env.STUDIO_URL ?? 'http://localhost:8082').replace(/\/$/, '')
const API  = `${BASE}/api/self-hosted/projects`

async function api(method, path, body, { allowNonOk = false } = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)

  let res
  try {
    res = await fetch(`${API}${path}`, opts)
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
  return data
}

function die(msg) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`)
  process.exit(1)
}

// ── formatters ───────────────────────────────────────────────────────────────

const STATUS_COLOR = {
  active:   '\x1b[32m', // green
  creating: '\x1b[33m', // yellow
  stopped:  '\x1b[90m', // grey
  error:    '\x1b[31m', // red
}

function colorStatus(s) {
  return `${STATUS_COLOR[s] ?? ''}${s}\x1b[0m`
}

const HEALTH_COLOR = {
  running:   '\x1b[32m✓\x1b[0m',
  stopped:   '\x1b[33m●\x1b[0m',
  'not found': '\x1b[31m✗\x1b[0m',
}

function colorHealth(s) {
  return `${HEALTH_COLOR[s] ?? s} ${s}`
}

function printTable(rows, cols) {
  // cols: [{ key, label, fmt? }]
  const widths = cols.map(c => c.label.length)
  for (const row of rows) {
    cols.forEach((c, i) => {
      const val = String((c.fmt ? c.fmt(row[c.key]) : row[c.key]) ?? '')
      // strip ANSI for width measurement
      const plain = val.replace(/\x1b\[[0-9;]*m/g, '')
      if (plain.length > widths[i]) widths[i] = plain.length
    })
  }

  const pad = (s, w) => {
    const plain = s.replace(/\x1b\[[0-9;]*m/g, '')
    return s + ' '.repeat(Math.max(0, w - plain.length))
  }

  const header = cols.map((c, i) => pad(c.label, widths[i])).join('  ')
  const sep    = widths.map(w => '─'.repeat(w)).join('  ')
  console.log(`\x1b[1m${header}\x1b[0m`)
  console.log(sep)
  for (const row of rows) {
    const line = cols.map((c, i) => {
      const val = String((c.fmt ? c.fmt(row[c.key]) : row[c.key]) ?? '')
      return pad(val, widths[i])
    }).join('  ')
    console.log(line)
  }
}

// ── commands ─────────────────────────────────────────────────────────────────

async function cmdList() {
  const projects = await api('GET', '')
  if (!projects.length) { console.log('No projects.'); return }

  printTable(projects, [
    { key: 'ref',    label: 'REF' },
    { key: 'name',   label: 'NAME' },
    { key: 'status', label: 'STATUS', fmt: colorStatus },
    { key: 'ports',  label: 'DB PORT',  fmt: p => p?.db  ?? '—' },
    { key: 'ports',  label: 'API PORT', fmt: p => p?.meta ?? '—' },
    { key: 'insertedAt', label: 'CREATED', fmt: s => s ? new Date(s).toLocaleDateString() : '—' },
  ])
}

async function cmdCreate(name) {
  if (!name) die('Usage: smh create <name>')
  console.log(`Creating project "${name}"…`)
  const p = await api('POST', '', { name })
  console.log(`\x1b[32m✓\x1b[0m Created  ref=${p.ref}  status=${p.status}`)
  console.log(`  DB port:   ${p.ports.db}`)
  console.log(`  API port:  ${p.ports.meta}`)
  console.log(`  Anon key:  ${p.anonKey}`)
}

async function cmdDelete(ref) {
  if (!ref) die('Usage: smh delete <ref>')
  const { message } = await api('DELETE', `/${ref}`)
  console.log(`\x1b[32m✓\x1b[0m ${message}`)
}

async function cmdStart(ref) {
  if (!ref) die('Usage: smh start <ref>')
  const { message } = await api('POST', `/${ref}/start`)
  console.log(`\x1b[32m✓\x1b[0m ${message}`)
}

async function cmdStop(ref) {
  if (!ref) die('Usage: smh stop <ref>')
  const { message } = await api('POST', `/${ref}/stop`)
  console.log(`\x1b[32m✓\x1b[0m ${message}`)
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
      ref: p.ref,
      name: p.name,
      overall: p.health?.overall ?? '—',
      db:   p.health?.db   ?? '—',
      meta: p.health?.meta ?? '—',
      rest: p.health?.rest ?? '—',
      auth: p.health?.auth ?? '—',
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

function usage() {
  console.log(`
\x1b[1msmh\x1b[0m — Supabase Multi-Head CLI

\x1b[1mUsage:\x1b[0m
  smh list                list all projects
  smh create <name>       create a new project
  smh delete <ref>        delete a project and its containers
  smh start  <ref>        start a stopped project
  smh stop   <ref>        stop a running project
  smh status <ref>        show registry details for a project
  smh health [ref]        show live container health (all projects if no ref)

\x1b[1mEnvironment:\x1b[0m
  STUDIO_URL   Studio base URL  (default: http://localhost:8082)
`.trim())
}

// ── main ─────────────────────────────────────────────────────────────────────

const [,, cmd, arg] = process.argv

switch (cmd) {
  case 'list':   await cmdList();         break
  case 'create': await cmdCreate(arg);    break
  case 'delete': await cmdDelete(arg);    break
  case 'start':  await cmdStart(arg);     break
  case 'stop':   await cmdStop(arg);      break
  case 'status': await cmdStatus(arg);    break
  case 'health': await cmdHealth(arg);    break
  default:       usage(); process.exit(cmd ? 1 : 0)
}
