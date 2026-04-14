# Supabase Multi-Head Studio

A self-hosted Supabase Dashboard that lets you **create and manage multiple isolated Supabase projects** from a single UI — no Supabase Cloud account required.

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
├── .env.example                # All configuration variables, documented
├── start.sh                    # New-install: one-command setup + launch
├── integrate.sh                # Existing-install: drop multi-head onto a running stack
├── build-push.sh               # Build the Studio image and push to GHCR
├── utils/
│   └── generate-keys.sh        # Generate JWT secret and API keys
└── volumes/                    # Init scripts for Postgres, Kong, Realtime, etc.
```

---

## New installation

**Start here if you have no existing Supabase deployment.**

**Prerequisites:** Docker Engine ≥ 24 with the Compose plugin.

```bash
# Get the multihead/ folder
git clone --filter=blob:none --sparse https://github.com/<owner>/supabase-studio-multi-head.git
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

That's it. The script:
1. Copies `docker-compose.overlay.yml` into your existing docker directory
2. Adds `MULTI_HEAD_IMAGE`, `MULTI_HEAD_HOST`, `STUDIO_DATA_DIR` to your `.env`
3. Detects Linux bridge IP automatically
4. Restarts only the Studio container — everything else keeps running

### Manual

```bash
# 1. Copy the overlay into your existing docker/ directory
cp docker-compose.overlay.yml /path/to/your/supabase/docker/

# 2. Add these three variables to your existing .env
cat >> /path/to/your/supabase/docker/.env <<'EOF'

MULTI_HEAD_IMAGE=ghcr.io/<owner>/supabase-studio-multi-head:latest
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
curl -s http://localhost:8000/api/platform/projects/import \
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
curl -s http://localhost:8000/api/platform/projects/import \
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

### Via projects.json (manual)

Edit `volumes/studio-data/projects.json` directly and add an entry:

```json
[
  {
    "id": 2,
    "ref": "abc123def456",
    "name": "My Other Stack",
    "organization_id": 1,
    "cloud_provider": "localhost",
    "status": "ACTIVE_HEALTHY",
    "region": "local",
    "inserted_at": "2026-01-01T00:00:00.000Z",
    "public_url": "http://host.docker.internal:8010",
    "kong_http_port": 8010,
    "postgres_port": 5442,
    "pooler_port": 6553,
    "pooler_tenant_id": "your-tenant-id",
    "db_password": "<postgres-password>",
    "anon_key": "<anon-key>",
    "service_key": "<service-role-key>",
    "jwt_secret": "<jwt-secret>"
  }
]
```

Restart Studio to pick up changes: `docker compose restart studio`

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

### Port allocation for new projects

Each new project gets a port block offset by `+10`:

| Service | Default | 1st extra | 2nd extra |
|---------|---------|-----------|-----------|
| Kong (HTTP) | 8000 | 8010 | 8020 |
| Postgres | 5432 | 5442 | 5452 |
| Pooler (transaction) | 6543 | 6553 | 6563 |

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
│    ├─ reads  /app/studio-data       → project registry (projects.json)
│    └─ uses   /app/supabase-docker/  → compose template baked into image
│
├─ kong, auth, rest, realtime, storage, meta, analytics, db, supavisor
│    └─ standard Supabase services (default project)
│
└─ extra project stacks (created on demand)
     ├─ supabase-<ref>  port block +10
     ├─ supabase-<ref>  port block +20
     └─ ...
```

**Key design decisions:**

- **No Docker-in-Docker**: Studio uses the host Docker socket to run `docker compose` as a sibling. The `docker` CLI binary is embedded in the image.
- **Template baked in**: The compose template is at `/app/supabase-docker/docker-compose.yml` inside the image. Override with `SUPABASE_COMPOSE_FILE`.
- **Credential isolation**: Every project gets fresh `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` generated by `crypto.randomBytes`.
- **Import without restart**: The `/api/platform/projects/import` endpoint registers external stacks live — no container restart needed.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Studio exits immediately | `docker compose logs studio` — usually missing image or `volumes/studio-data/` |
| "Cannot connect to Docker daemon" | Check socket: `ls -la /var/run/docker.sock`, see Linux notes |
| Extra project services unreachable | Wrong `MULTI_HEAD_HOST` — verify bridge IP on Linux |
| Port conflict on new project | Edit `volumes/studio-data/projects.json`, change `kong_http_port`, restart Studio |
| Reset everything | `docker compose down -v && rm -f volumes/studio-data/projects.json` |
