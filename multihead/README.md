# Supabase Multi-Head Studio

A self-hosted Supabase Dashboard that lets you **create and manage multiple isolated Supabase projects** from a single UI — no Supabase Cloud account required.

**Business and Enterprise tiers** unlock high-availability features: read replicas, hot standbys, automatic failover, and cluster mode.

---

## Choose your path

| I want to… | Use |
|---|---|
| Start fresh with a brand-new Supabase deployment | [**New installation**](#new-installation) |
| Upgrade an existing Supabase self-hosted to multi-head | [**Integrate with existing deployment**](#integrate-with-existing-deployment) |
| Import a Supabase stack running on another host | [**Import a remote stack**](#import-a-remote-stack) |

---

## What's inside

```
multihead/
├── docker-compose.yml          # Full Supabase stack with multi-head Studio pre-wired (new install)
├── docker-compose.overlay.yml  # Overlay for existing Supabase deployments (upgrade path)
├── start.sh                    # New-install: one-command setup + launch
├── integrate.sh                # Existing-install: drop multi-head onto a running stack
├── build-push.sh               # Build the Studio image and push to GHCR
├── cli/
│   └── smh.mjs                 # smh CLI — manage projects, orgs, members, replicas, failover, license
├── tests/
│   └── test-cluster-failover.mjs  # E2E test suite (cluster / failover / replication)
└── utils/
    └── generate-keys.sh        # Generate JWT secret and API keys
```

---

## New installation

**Start here if you have no existing Supabase deployment.**

**Prerequisites:** Docker Engine ≥ 24 with the Compose plugin, Node.js ≥ 22 (for the CLI).

```bash
# Get the multihead/ folder
git clone --filter=blob:none --sparse https://github.com/flamingrubberduck/supabase-studio-multi-head.git
cd supabase-studio-multi-head && git sparse-checkout set multihead && cd multihead

# Launch (auto-generates .env from .env.example and prompts you to review it)
bash start.sh
```

Studio will be at **http://localhost:8000** within ~30 seconds.

### Manual steps

```bash
cp .env.example .env

# Generate secrets and paste them into .env
bash utils/generate-keys.sh

# Linux only: set MULTI_HEAD_HOST to your Docker bridge IP
BRIDGE=$(docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}')
sed -i "s|^MULTI_HEAD_HOST=.*|MULTI_HEAD_HOST=${BRIDGE}|" .env

mkdir -p volumes/studio-data
docker compose up -d --remove-orphans
```

---

## Integrate with existing deployment

**Use this if you already have a Supabase self-hosted stack and want to upgrade Studio to multi-head.**

Your existing Postgres data, Auth users, and Storage are untouched. Only the Studio container is replaced.

### Automated

```bash
# Run from the multihead/ folder, point it at your existing Supabase docker/ directory
bash integrate.sh /path/to/your/supabase/docker
```

The script:
1. Copies `docker-compose.overlay.yml` into your existing docker directory
2. Adds `MULTI_HEAD_IMAGE`, `MULTI_HEAD_HOST`, `STUDIO_DATA_DIR` to your `.env`
3. Detects Linux bridge IP automatically
4. Restarts only the Studio container — everything else keeps running

### Manual

```bash
# 1. Copy the overlay into your existing docker/ directory
cp docker-compose.overlay.yml /path/to/your/supabase/docker/

# 2. Add these variables to your existing .env
cat >> /path/to/your/supabase/docker/.env <<'EOF'

MULTI_HEAD_IMAGE=ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest
MULTI_HEAD_HOST=host.docker.internal   # Linux: use your Docker bridge IP instead
STUDIO_DATA_DIR=./volumes/studio-data
EOF

# 3. Create the project registry directory
mkdir -p /path/to/your/supabase/docker/volumes/studio-data

# 4. Apply — only Studio is restarted
cd /path/to/your/supabase/docker
docker compose -f docker-compose.yml -f docker-compose.overlay.yml up -d --no-deps studio
```

### Going forward

Always include the overlay when managing your stack:

```bash
# Start / restart
docker compose -f docker-compose.yml -f docker-compose.overlay.yml up -d

# Upgrade Studio image
docker compose -f docker-compose.yml -f docker-compose.overlay.yml pull studio
docker compose -f docker-compose.yml -f docker-compose.overlay.yml up -d studio

# Stop everything
docker compose -f docker-compose.yml -f docker-compose.overlay.yml down
```

### Rollback to standard Studio

```bash
# Without the overlay, Compose restores the original studio image from docker-compose.yml
docker compose up -d studio
```

---

## Import a remote stack

**Use this if you have a Supabase deployment on a different host** (or a separate Docker network) that you want multi-head Studio to display alongside your other projects.

Multi-head registers the stack so you can browse its database, tables, and Auth users. It cannot orchestrate (start/stop) containers on a remote host.

### Via the API

```bash
# Same-host stack (different ports on this machine)
curl -s -u supabase:<dashboard-password> http://localhost:8000/api/platform/projects/import \
  -H 'Content-Type: application/json' \
  -d '{
    "name":           "My Other Stack",
    "public_url":     "http://host.docker.internal:8010",
    "kong_http_port": 8010,
    "postgres_port":  5442,
    "pooler_port":    6553,
    "pooler_tenant_id": "your-tenant-id",
    "anon_key":       "<anon-key>",
    "service_key":    "<service-role-key>",
    "jwt_secret":     "<jwt-secret>",
    "db_password":    "<postgres-password>"
  }'

# Remote host (different machine)
curl -s -u supabase:<dashboard-password> http://localhost:8000/api/platform/projects/import \
  -H 'Content-Type: application/json' \
  -d '{
    "name":        "Remote Server",
    "public_url":  "http://192.168.1.50:8000",
    "db_host":     "192.168.1.50",
    "db_port":     5432,
    "db_user":     "postgres",
    "db_name":     "postgres",
    "db_password": "<postgres-password>",
    "anon_key":    "<anon-key>",
    "service_key": "<service-role-key>",
    "jwt_secret":  "<jwt-secret>"
  }'
```

The project appears in the Studio dashboard immediately with **ACTIVE_HEALTHY** status.

---

## smh CLI

`smh` is a Node.js CLI for managing multi-head projects, organizations, members, replicas, standbys, failover, and licenses from the terminal.

```bash
# Install (from the repo root or multihead/ directory)
node multihead/cli/smh.mjs --help

# Or add to PATH
chmod +x multihead/cli/smh.mjs
ln -s $(pwd)/multihead/cli/smh.mjs /usr/local/bin/smh
```

### Environment

```bash
export STUDIO_URL=http://localhost:8000          # Studio base URL (default: http://localhost:8000)
export DASHBOARD_USERNAME=supabase               # Basic auth username
export DASHBOARD_PASSWORD=your-dashboard-password
```

### Project management

```bash
smh list                    # list all projects
smh create <name>           # create a new project (spawns a Docker stack)
smh rename <ref> <name>     # rename a project
smh delete <ref>            # delete a project and its containers
smh start  <ref>            # start a stopped project
smh stop   <ref>            # stop a running project
smh status <ref>            # show registry details for a project
smh health [ref]            # show live container health
```

### Organization management

```bash
smh org list                      # list all organizations
smh org create <name>             # create a new organization
smh org rename <slug> <name>      # rename an organization
```

### Member management

```bash
smh member list   <org-slug>                                      # list org members
smh member add    <org-slug> <email> --role <role> [--password <pw>]  # add a member
smh member remove <org-slug> <gotrue_id>                          # remove a member
```

Available roles: `owner`, `administrator`, `developer`, `readonly`

In GoTrue auth mode (`NEXT_PUBLIC_STUDIO_AUTH=gotrue`) a `--password` is required when adding members. In the default mode a password is optional.

### License

```bash
smh license status              # show current tier (free / business / enterprise) and grace state
smh license activate <key>      # activate a license key
smh license deactivate          # revert to free tier
```

### High availability (Business/Enterprise tier only)

```bash
# Read replicas — streaming replicas in a cluster  [Enterprise]
smh replica add    <ref> [--host <docker_host>]   # provision a read replica
smh replica remove <ref> <replica_ref>             # deprovision a replica

# Hot standby — automatic failover target  [Business]
smh standby add    <ref> [--host <docker_host>]   # provision a hot standby
smh standby remove <ref>                           # remove the standby

# Manual failover
smh failover         <ref>   # promote standby to primary  [Business]
smh cluster-failover <ref>   # promote highest-rank healthy replica to master  [Enterprise]
```

---

## GoTrue auth (Studio login)

By default Studio runs without user authentication (bypassed for self-hosted). To enable real login via the stack's GoTrue service, set:

```dotenv
NEXT_PUBLIC_STUDIO_AUTH=gotrue
STUDIO_GOTRUE_SERVICE_KEY=<service_role_jwt>
```

On first start, Studio redirects to **/setup** where you create the initial Owner account. After that, the sign-in page requires credentials.

### Roles

| Role | Capabilities |
|------|-------------|
| **Owner** | Full access to all resources, members, and org settings |
| **Administrator** | Manage project settings and team members |
| **Developer** | Read/write access to project data; cannot manage members or org |
| **Read-only** | Read access to project data only |

Roles can be scoped to specific projects — a member can be Developer on one project and Read-only on another within the same organization.

### Bootstrap API

```bash
# One-time endpoint to create the first Owner (only callable when no members exist)
curl -s -X POST http://localhost:8000/api/self-hosted/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme"}'
```

---

## High availability features (Business/Enterprise)

Business and Enterprise tiers unlock three HA mechanisms that work independently or together.

| Feature | Minimum tier |
|---------|-------------|
| Multiple projects | Business |
| Hot standby + failover | Business |
| Read replicas + auto-failover | Business |
| Cluster mode + cluster-failover | Enterprise |

### License activation

Licenses are signed JWTs validated locally — no phone-home required after activation.

```bash
smh license activate <your-key>
# or via API:
curl -s -u supabase:<password> -X PATCH http://localhost:8000/api/platform/license \
  -H 'Content-Type: application/json' -d '{"key":"<your-key>"}'
```

A **7-day grace period** keeps the paid tier active if the license server is temporarily unreachable. After grace expires the instance reverts to free.

### Read replicas (cluster mode)

Cluster mode runs one master + N read replicas using PostgreSQL WAL streaming replication. Replicas are ranked (1 = highest priority for promotion).

```bash
# Add a replica to project <ref>
smh replica add <ref>

# Add a replica on a different Docker host
smh replica add <ref> --host ssh://user@replica-host.example.com

# Remove a replica
smh replica remove <ref> <replica_ref>

# Promote the highest-rank healthy replica to master
smh cluster-failover <ref>
```

**What happens under the hood:**
- A new Postgres instance is spun up via `pg_basebackup`
- WAL streaming replication is configured automatically
- Replica inherits the master's JWT/anon/service keys so client tokens stay valid
- The health poller marks unreachable replicas as `INACTIVE` and re-ranks on promotion

### Hot standby (primary/standby failover)

A standby is a warm replica configured for automatic promotion on primary failure.

```bash
# Add a standby for project <ref>
smh standby add <ref>

# Manually trigger failover (standby → primary)
smh failover <ref>
```

**Failover sequence:**
1. `pg_promote()` is called on the standby
2. The standby's connection details (ports, URL) are swapped onto the primary registry entry — **the ref stays the same**, so all clients reconnect automatically
3. The old primary stack is torn down in the background
4. A new standby is provisioned in the background to restore HA

### Automatic failover via health poller

The health poller runs in the background every 30 seconds, checking the Kong endpoint (`/rest/v1/`) of each active project.

| Consecutive failures | Action |
|---|---|
| 1–2 | Increment `failure_streak`, log warning |
| 3 | **Trigger failover** (primary/standby) or **cluster-failover** (cluster master) |

Standby and replica projects are polled but never promoted by the poller — only primary/master projects trigger failover. Free-tier projects skip failover (streak is still tracked).

---

## Configuration reference

### Secrets (change before first start)

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Postgres master password |
| `JWT_SECRET` | HS256 signing secret (≥ 32 chars) |
| `ANON_KEY` | Anonymous role JWT |
| `SERVICE_ROLE_KEY` | Service role JWT |
| `DASHBOARD_PASSWORD` | Studio login password |

Generate all at once: `bash utils/generate-keys.sh`

### Multi-head variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MULTI_HEAD_IMAGE` | `ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest` | Studio Docker image |
| `MULTI_HEAD_HOST` | `host.docker.internal` | Hostname at which extra project stacks are reachable from inside the Studio container |
| `STUDIO_DATA_DIR` | `./volumes/studio-data` | Host path for `projects.json` project registry |
| `MULTI_HEAD_LICENSE_SECRET` | *(unset)* | HMAC secret used to verify license key signatures |
| `NEXT_PUBLIC_STUDIO_AUTH` | *(unset)* | Set to `gotrue` to enable GoTrue-backed Studio login |
| `STUDIO_GOTRUE_SERVICE_KEY` | *(unset)* | Service role JWT for GoTrue admin API (required in GoTrue mode) |

### Port allocation for new projects

Each new project gets a port block offset by `+10`:

| Service | Default | 1st extra | 2nd extra |
|---------|---------|-----------|-----------|
| Kong (HTTP) | 8000 | 8010 | 8020 |
| Postgres | 5432 | 5442 | 5452 |
| Pooler (transaction) | 6543 | 6553 | 6563 |

---

## API reference

All endpoints require HTTP Basic auth (`DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`).

### Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/platform/projects` | List all projects |
| `POST` | `/api/platform/projects` | Create a project |
| `GET` | `/api/platform/projects/:ref` | Get project details |
| `PATCH` | `/api/platform/projects/:ref` | Rename a project `{"name":"…"}` |
| `DELETE` | `/api/platform/projects/:ref` | Delete a project |
| `POST` | `/api/platform/projects/import` | Register an external stack |

### Organizations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/platform/organizations` | List all organizations |
| `POST` | `/api/platform/organizations` | Create an organization |
| `GET` | `/api/platform/organizations/:slug` | Get organization details |
| `PATCH` | `/api/platform/organizations/:slug` | Rename org `{"name":"…"}` |
| `DELETE` | `/api/platform/organizations/:slug` | Delete an organization (must have no projects) |

### Members & roles

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/platform/organizations/:slug/members` | List org members |
| `GET` | `/api/platform/organizations/:slug/members/invitations` | List pending invitations (always empty in self-hosted) |
| `POST` | `/api/platform/organizations/:slug/members/invitations` | Add a member `{"email","role_id"[,"password"]}` |
| `PATCH` | `/api/platform/organizations/:slug/members/:id` | Assign a role `{"role_id"[,"role_scoped_projects":[]]}` |
| `DELETE` | `/api/platform/organizations/:slug/members/:id` | Remove a member |
| `GET` | `/api/platform/organizations/:slug/roles` | List available roles |
| `PUT` | `/api/platform/organizations/:slug/members/:id/roles/:role_id` | Update project-scoped role refs |
| `DELETE` | `/api/platform/organizations/:slug/members/:id/roles/:role_id` | Remove a specific role from a member |
| `GET` | `/api/platform/profile/permissions` | Get RBAC permissions for the current user |

Role IDs: `1` = Owner, `2` = Administrator, `3` = Developer, `4` = Read-only

### High availability (Business/Enterprise)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/platform/projects/:ref/replica` | Provision a read replica |
| `DELETE` | `/api/platform/projects/:ref/replica` | Remove a replica (`?replica_ref=<ref>`) |
| `POST` | `/api/platform/projects/:ref/standby` | Provision a hot standby |
| `DELETE` | `/api/platform/projects/:ref/standby` | Remove the standby |
| `POST` | `/api/platform/projects/:ref/failover` | Trigger primary → standby promotion |
| `POST` | `/api/platform/projects/:ref/cluster-failover` | Promote best replica to master |

### License

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/platform/license` | Get current tier and grace state |
| `PATCH` | `/api/platform/license` | Activate a license key `{"key":"<jwt>"}` |
| `DELETE` | `/api/platform/license` | Deactivate — revert to free tier |

---

## Building from source

```bash
# From the repo root
bash multihead/build-push.sh -o <your-github-username>

# With version tag + multi-platform
bash multihead/build-push.sh -o <your-github-username> -t v1.0.0 -p linux/amd64,linux/arm64
```

See `build-push.sh --help` for all options.

After pushing, update `MULTI_HEAD_IMAGE` in your `.env`:
```dotenv
MULTI_HEAD_IMAGE=ghcr.io/<your-username>/supabase-studio-multi-head:latest
```

---

## Running tests

### Unit tests (Vitest)

Covers health poller, failover manager, cluster manager, and replication manager.

```bash
cd apps/studio
./node_modules/.bin/vitest run lib/api/self-hosted/
```

### E2E tests

Tests the full API surface against a running stack. Requires the stack to be up (`bash multihead/start.sh`).

```bash
# Run against default URL (http://localhost:8000)
node multihead/tests/test-cluster-failover.mjs

# Run against a different URL
STUDIO_URL=http://myhost:8000 node multihead/tests/test-cluster-failover.mjs

# Enable Business/Enterprise flow (requires a valid license key)
SMH_LICENSE_KEY=<your-key> node multihead/tests/test-cluster-failover.mjs
```

Credentials are auto-read from `docker/.env`. Set `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` to override.

**Test groups:**

| Group | What's tested |
|-------|--------------|
| License API | GET/PATCH/DELETE `/api/platform/license` |
| License gating | Business/Enterprise-required endpoints return 402 on free tier |
| Replica API contract | Validation, missing params, method guards |
| Standby API contract | Same checks for standby endpoints |
| Failover API contract | POST /failover and /cluster-failover guards |
| smh CLI basic | `list`, `license status/activate/deactivate`, `help` |
| Business/Enterprise flow *(optional)* | Full create → replica → standby → failover → cleanup cycle |

---

## Linux notes

`host.docker.internal` does not resolve automatically on Linux. `start.sh` and `integrate.sh` both handle this automatically. For manual setup:

```bash
# Get the bridge IP
docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}'

# Set in .env
MULTI_HEAD_HOST=172.17.0.1
```

**Docker socket permissions:**
```bash
# If Studio logs show "permission denied" on /var/run/docker.sock:
sudo usermod -aG docker $USER   # then log out and back in
```

---

## Architecture

```
multihead/docker-compose.yml  (or overlay on existing stack)
│
├─ studio (multi-head image)
│    ├─ mounts /var/run/docker.sock   → spawns new project stacks via Docker CLI
│    ├─ reads  /app/studio-data       → project registry (projects.json, members.json)
│    ├─ uses   /app/supabase-docker/  → compose template baked into image
│    └─ health poller                 → polls projects every 30 s, triggers failover
│
├─ kong, auth, rest, realtime, storage, meta, analytics, db, supavisor
│    └─ standard Supabase services (default project)
│
└─ extra project stacks (created on demand)
     ├─ supabase-<ref>         master / primary      port block +10
     ├─ supabase-<ref>-standby hot standby           port block +20
     ├─ supabase-<ref>-r1      read replica rank 1   port block +30
     └─ ...
```

**Key design decisions:**

- **No Docker-in-Docker**: Studio uses the host Docker socket to run `docker compose` as a sibling. The `docker` CLI binary is embedded in the image.
- **Template baked in**: The compose template is at `/app/supabase-docker/docker-compose.yml` inside the image. Override with `SUPABASE_COMPOSE_FILE`.
- **Credential isolation**: Every project gets fresh `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` generated by `crypto.randomBytes`.
- **Token continuity**: Standbys and replicas inherit the primary's JWT/anon/service keys so existing client tokens remain valid after failover.
- **Import without restart**: The `/api/platform/projects/import` endpoint registers external stacks live — no container restart needed.
- **Offline-friendly licensing**: License keys are signed JWTs verified with a local HMAC secret. No internet connection required after the key is stored.
- **GoTrue auth**: When `NEXT_PUBLIC_STUDIO_AUTH=gotrue`, Studio login is backed by the stack's own GoTrue service. Members are stored in `members.json` linked by GoTrue user ID.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Studio exits immediately | `docker compose logs studio` — usually missing image or `volumes/studio-data/` |
| "Cannot connect to Docker daemon" | Check socket: `ls -la /var/run/docker.sock`, see Linux notes |
| Extra project services unreachable | Wrong `MULTI_HEAD_HOST` — verify bridge IP on Linux |
| Port conflict on new project | Edit `volumes/studio-data/projects.json`, change `kong_http_port`, restart Studio |
| Reset everything | `docker compose down -v && rm -f volumes/studio-data/projects.json` |
| API returns 401 | Pass Basic auth: `curl -u supabase:<password> …` or set `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` |
| Failover not triggering | Check `MULTI_HEAD_LICENSE_SECRET` is set and license is Business/Enterprise (`smh license status`) |
| Replica stuck in COMING_UP | Check Docker logs for `pg_basebackup` errors; verify Postgres is reachable on `postgres_port` |
| GoTrue login fails | Verify `STUDIO_GOTRUE_SERVICE_KEY` is the service role JWT; check `/setup` page for first-run bootstrap |
