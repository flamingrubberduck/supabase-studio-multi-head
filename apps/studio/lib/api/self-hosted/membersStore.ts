import fs from 'node:fs'
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'

const DATA_DIR = process.env.STUDIO_DATA_DIR || path.join(process.cwd(), '.studio-data')
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json')

export const SELF_HOSTED_ROLES = [
  { id: 1, name: 'Owner', base_role_id: 1, description: 'Full access to all resources and members', projects: [] },
  { id: 2, name: 'Administrator', base_role_id: 2, description: 'Manage project settings and team', projects: [] },
  { id: 3, name: 'Developer', base_role_id: 3, description: 'Read and write access to project data', projects: [] },
  { id: 4, name: 'Read-only', base_role_id: 4, description: 'Read-only access to project data', projects: [] },
] as const

export interface StoredMember {
  id: number
  gotrue_id: string
  username: string
  primary_email: string
  role_ids: number[]
  created_at: string
  mfa_enabled: boolean
  is_sso_user: boolean
  metadata: Record<string, unknown>
  password_hash?: string
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyMemberPassword(password: string, stored: string): boolean {
  const colonIdx = stored.indexOf(':')
  if (colonIdx === -1) return false
  const salt = stored.slice(0, colonIdx)
  const hash = stored.slice(colonIdx + 1)
  try {
    const derived = scryptSync(password, salt, 64)
    return timingSafeEqual(derived, Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

export function findMemberByEmail(email: string): { member: StoredMember; org_slug: string } | null {
  const store = read()
  const lc = email.toLowerCase()
  for (const [slug, data] of Object.entries(store)) {
    const member = data.members.find((m) => m.primary_email.toLowerCase() === lc)
    if (member) return { member, org_slug: slug }
  }
  return null
}

export function findMemberByGotrueId(gotrue_id: string): { member: StoredMember; org_slug: string } | null {
  const store = read()
  for (const [slug, data] of Object.entries(store)) {
    const member = data.members.find((m) => m.gotrue_id === gotrue_id)
    if (member) return { member, org_slug: slug }
  }
  return null
}

interface OrgData {
  members: StoredMember[]
}

type Store = Record<string, OrgData>

function read(): Store {
  try {
    if (!fs.existsSync(MEMBERS_FILE)) return {}
    return JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function write(store: Store): void {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(MEMBERS_FILE, JSON.stringify(store, null, 2), 'utf-8')
}

function orgData(store: Store, slug: string): OrgData {
  return store[slug] ?? { members: [] }
}

export function getOrgMembers(slug: string): StoredMember[] {
  return orgData(read(), slug).members
}

export function addOrgMember(
  slug: string,
  data: { primary_email: string; role_id: number; username?: string; password?: string }
): StoredMember {
  const store = read()
  const org = orgData(store, slug)

  const maxId = org.members.reduce((m, x) => Math.max(m, x.id), 0)
  const member: StoredMember = {
    id: maxId + 1,
    gotrue_id: randomUUID(),
    username: data.username ?? data.primary_email.split('@')[0],
    primary_email: data.primary_email,
    role_ids: [data.role_id],
    created_at: new Date().toISOString(),
    mfa_enabled: false,
    is_sso_user: false,
    metadata: {},
    ...(data.password ? { password_hash: hashPassword(data.password) } : {}),
  }

  org.members.push(member)
  store[slug] = org
  write(store)
  return member
}

export function assignOrgMemberRole(
  slug: string,
  gotrue_id: string,
  role_id: number
): StoredMember | null {
  const store = read()
  const org = orgData(store, slug)
  const idx = org.members.findIndex((m) => m.gotrue_id === gotrue_id)
  if (idx === -1) return null

  // Replace all roles with the new one (org-scoped, single role)
  org.members[idx] = { ...org.members[idx], role_ids: [role_id] }
  store[slug] = org
  write(store)
  return org.members[idx]
}

export function unassignOrgMemberRole(
  slug: string,
  gotrue_id: string,
  role_id: number
): StoredMember | null {
  const store = read()
  const org = orgData(store, slug)
  const idx = org.members.findIndex((m) => m.gotrue_id === gotrue_id)
  if (idx === -1) return null

  org.members[idx] = {
    ...org.members[idx],
    role_ids: org.members[idx].role_ids.filter((r) => r !== role_id),
  }
  store[slug] = org
  write(store)
  return org.members[idx]
}

export function deleteOrgMember(slug: string, gotrue_id: string): boolean {
  const store = read()
  const org = orgData(store, slug)
  const before = org.members.length
  org.members = org.members.filter((m) => m.gotrue_id !== gotrue_id)
  if (org.members.length === before) return false
  store[slug] = org
  write(store)
  return true
}
