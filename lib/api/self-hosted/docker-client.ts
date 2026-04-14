/**
 * Minimal Docker Engine API client over Unix socket.
 * No external dependencies — uses Node's built-in http module.
 * Only call this from server-side self-hosted code.
 */

import http from 'http'

const DOCKER_SOCKET = process.env.DOCKER_SOCKET_LOCATION ?? '/var/run/docker.sock'
const API_VERSION = 'v1.41'

interface DockerResponse<T = unknown> {
  status: number
  data: T
}

function request<T = unknown>(
  method: string,
  path: string,
  body?: object
): Promise<DockerResponse<T>> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path: `/${API_VERSION}${path}`,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }

    const req = http.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => (raw += chunk))
      res.on('end', () => {
        let data: T
        try {
          data = JSON.parse(raw) as T
        } catch {
          data = raw as unknown as T
        }
        resolve({ status: res.statusCode ?? 0, data })
      })
    })

    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ---- Networks ----------------------------------------------------------------

export async function networkExists(name: string): Promise<boolean> {
  const res = await request('GET', `/networks/${name}`)
  return res.status === 200
}

export async function createNetwork(name: string): Promise<void> {
  const exists = await networkExists(name)
  if (exists) return
  const res = await request('POST', '/networks/create', {
    Name: name,
    CheckDuplicate: true,
  })
  if (res.status !== 201) {
    throw new Error(`Failed to create network ${name}: ${JSON.stringify(res.data)}`)
  }
}

export async function connectContainerToNetwork(
  networkName: string,
  containerName: string
): Promise<void> {
  const res = await request('POST', `/networks/${networkName}/connect`, {
    Container: containerName,
  })
  // 200 = connected, 404 = container not found — surface only hard failures
  if (res.status !== 200 && res.status !== 409 /* already connected */) {
    throw new Error(
      `Failed to connect ${containerName} to ${networkName}: ${JSON.stringify(res.data)}`
    )
  }
}

// ---- Volumes -----------------------------------------------------------------

export async function createVolume(name: string): Promise<void> {
  const res = await request('POST', '/volumes/create', { Name: name })
  if (res.status !== 201) {
    throw new Error(`Failed to create volume ${name}: ${JSON.stringify(res.data)}`)
  }
}

export async function removeVolume(name: string): Promise<void> {
  await request('DELETE', `/volumes/${name}?force=true`)
}

// ---- Containers --------------------------------------------------------------

export interface ContainerConfig {
  name: string
  image: string
  env: Record<string, string>
  networks: string[]
  /** host_port → container_port */
  portBindings?: Record<string, number>
  volumes?: Array<{ volumeName: string; containerPath: string }>
  cmd?: string[]
  restartPolicy?: 'no' | 'unless-stopped' | 'always'
  dependsOn?: string[] // container names to wait to be healthy (best-effort)
}

export async function pullImage(image: string): Promise<void> {
  // fromImage param expects "name:tag"
  const [fromImage, tag = 'latest'] = image.split(':')
  const res = await request('POST', `/images/create?fromImage=${fromImage}&tag=${tag}`)
  if (res.status !== 200) {
    throw new Error(`Failed to pull image ${image}: ${JSON.stringify(res.data)}`)
  }
}

export async function createContainer(config: ContainerConfig): Promise<string> {
  const portBindings: Record<string, { HostPort: string }[]> = {}
  const exposedPorts: Record<string, Record<string, never>> = {}

  for (const [hostPort, containerPort] of Object.entries(config.portBindings ?? {})) {
    const key = `${containerPort}/tcp`
    exposedPorts[key] = {}
    portBindings[key] = [{ HostPort: String(hostPort) }]
  }

  const binds = (config.volumes ?? []).map((v) => `${v.volumeName}:${v.containerPath}`)

  const networkingConfig: Record<string, unknown> = {}
  if (config.networks.length > 0) {
    networkingConfig.EndpointsConfig = Object.fromEntries(
      config.networks.map((n) => [n, {}])
    )
  }

  const body = {
    Image: config.image,
    Env: Object.entries(config.env).map(([k, v]) => `${k}=${v}`),
    ExposedPorts: exposedPorts,
    Cmd: config.cmd,
    HostConfig: {
      Binds: binds,
      PortBindings: portBindings,
      RestartPolicy: { Name: config.restartPolicy ?? 'unless-stopped' },
      NetworkMode: config.networks[0],
    },
    NetworkingConfig: networkingConfig,
  }

  const res = await request<{ Id: string; message?: string }>(
    'POST',
    `/containers/create?name=${config.name}`,
    body
  )

  if (res.status !== 201) {
    throw new Error(`Failed to create container ${config.name}: ${JSON.stringify(res.data)}`)
  }

  // Connect to additional networks (can only set one in create call)
  for (const network of config.networks.slice(1)) {
    await connectContainerToNetwork(network, config.name)
  }

  return res.data.Id
}

export async function startContainer(idOrName: string): Promise<void> {
  const res = await request('POST', `/containers/${idOrName}/start`)
  // 204 = started, 304 = already running
  if (res.status !== 204 && res.status !== 304) {
    throw new Error(`Failed to start ${idOrName}: ${JSON.stringify(res.data)}`)
  }
}

export async function stopContainer(idOrName: string): Promise<void> {
  await request('POST', `/containers/${idOrName}/stop?t=10`)
}

export async function removeContainer(idOrName: string): Promise<void> {
  await request('DELETE', `/containers/${idOrName}?force=true`)
}

export interface ContainerState {
  exists: boolean
  running: boolean
  status: string
}

export async function inspectContainer(name: string): Promise<ContainerState> {
  const res = await request<{ State?: { Running: boolean; Status: string } }>(
    'GET',
    `/containers/${name}/json`
  )
  if (res.status === 404) return { exists: false, running: false, status: 'not found' }
  return {
    exists: true,
    running: res.data.State?.Running ?? false,
    status: res.data.State?.Status ?? 'unknown',
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    const res = await request('GET', '/info')
    return res.status === 200
  } catch {
    return false
  }
}
