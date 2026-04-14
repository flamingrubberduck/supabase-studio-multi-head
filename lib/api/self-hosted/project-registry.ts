/**
 * Project registry — persisted as a JSON file in the projects volume.
 * Only call this from server-side self-hosted code.
 */

import fs from 'fs'
import path from 'path'

export const PROJECTS_DIR = process.env.SELF_HOSTED_PROJECTS_DIR ?? '/app/projects'
const REGISTRY_FILE = path.join(PROJECTS_DIR, 'registry.json')

export type ProjectStatus = 'creating' | 'active' | 'stopped' | 'error'

export interface SelfHostedProject {
  id: number
  ref: string
  name: string
  status: ProjectStatus
  /** URL Studio uses to reach pg-meta for this project */
  metaUrl: string
  /** GoTrue auth URL */
  authUrl: string
  /** Kong/API gateway URL */
  kongUrl: string
  /** Direct Postgres connection info (internal Docker network) */
  db: {
    host: string
    port: number
    name: string
    password: string
  }
  jwtSecret: string
  anonKey: string
  serviceRoleKey: string
  insertedAt: string
  /** Prefix used for all container/volume/network names */
  containerPrefix: string
  /** PostgREST (Data API) URL */
  restUrl: string
  /** Ports allocated on the host */
  ports: {
    meta: number
    kong: number
    db: number
    auth: number
    rest: number
  }
}

interface Registry {
  projects: SelfHostedProject[]
  nextId: number
}

function readRegistry(): Registry {
  if (!fs.existsSync(REGISTRY_FILE)) {
    return { projects: [], nextId: 2 } // id 1 = default project
  }
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8')) as Registry
  } catch {
    return { projects: [], nextId: 2 }
  }
}

function writeRegistry(registry: Registry): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true })
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8')
}

export function getAllProjects(): SelfHostedProject[] {
  return readRegistry().projects
}

export function getProject(ref: string): SelfHostedProject | undefined {
  return readRegistry().projects.find((p) => p.ref === ref)
}

export function addProject(project: Omit<SelfHostedProject, 'id'>): SelfHostedProject {
  const registry = readRegistry()
  const newProject = { ...project, id: registry.nextId }
  registry.projects.push(newProject)
  registry.nextId += 1
  writeRegistry(registry)
  return newProject
}

export function updateProjectStatus(ref: string, status: ProjectStatus): void {
  const registry = readRegistry()
  const project = registry.projects.find((p) => p.ref === ref)
  if (project) {
    project.status = status
    writeRegistry(registry)
  }
}

export function removeProject(ref: string): void {
  const registry = readRegistry()
  registry.projects = registry.projects.filter((p) => p.ref !== ref)
  writeRegistry(registry)
}

/** Returns the next available port for each service type, avoiding collisions. */
export function allocatePorts(): { meta: number; kong: number; db: number; auth: number } {
  const registry = readRegistry()
  const usedMeta = new Set(registry.projects.map((p) => p.ports.meta))
  const usedKong = new Set(registry.projects.map((p) => p.ports.kong))
  const usedDb = new Set(registry.projects.map((p) => p.ports.db))
  const usedAuth = new Set(registry.projects.map((p) => p.ports.auth).filter(Boolean))
  const usedRest = new Set(registry.projects.map((p) => p.ports.rest).filter(Boolean))

  const nextFree = (used: Set<number>, start: number) => {
    let port = start
    while (used.has(port)) port++
    return port
  }

  return {
    meta: nextFree(usedMeta, 8201),
    kong: nextFree(usedKong, 8101),
    db: nextFree(usedDb, 5433),
    auth: nextFree(usedAuth, 9201),
    rest: nextFree(usedRest, 8301),
  }
}
