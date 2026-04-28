# One Dashboard, Many Databases: Multi-Head Supabase Studio

If you self-host Supabase, you know the drill: one `docker compose up`, one Kong gateway, one Postgres instance, one Studio dashboard. That's fine for a single project — but the moment you need a staging environment, a separate client project, or just a clean sandbox to experiment in, you're back to manually cloning compose files, juggling port numbers, and opening a second browser tab to a different URL.

**Multi-Head Studio** removes that friction. It's a fork of the official Supabase Dashboard that lets you create and manage multiple fully-isolated Supabase projects from a single UI — without a Supabase Cloud account, without leaving your own infrastructure.

## What it actually does

Each "project" is a complete, independent Supabase stack: its own Postgres database, Auth service, Storage, Realtime, REST API, and pg-meta — all behind its own Kong gateway on a fresh port block. When you click **New Project** in the dashboard, Studio spawns that entire stack in the background using the Docker socket, generates fresh credentials for it automatically, and registers it in the project switcher. The whole thing takes about 30 seconds.

The architecture is deliberately simple. There's no Kubernetes, no sidecar proxies, no orchestration layer to maintain. The Studio container mounts `/var/run/docker.sock` and runs `docker compose` as a sibling process on the host — standard Docker, no Docker-in-Docker.

```
Studio container
 └─ mounts /var/run/docker.sock
     └─ runs: docker compose up (new project stack)
                 ├─ kong:8010
                 ├─ postgres:5442
                 ├─ auth, storage, realtime, meta...
                 └─ pooler:6553
```

Port allocation is automatic and collision-free: each new project gets a block offset by `+10` from the previous one (Kong on 8010, 8020, 8030...; Postgres on 5442, 5452...).

## Three ways to get started

**Fresh install** — if you don't have an existing Supabase deployment:

```bash
git clone --filter=blob:none --sparse \
  https://github.com/flamingrubberduck/supabase-studio-multi-head.git
cd supabase-studio-multi-head && git sparse-checkout set multihead && cd multihead
bash start.sh
```

Studio is at `http://localhost:8000` within 30 seconds. `start.sh` handles key generation, Linux bridge IP detection, and directory setup automatically.

**Overlay on an existing deployment** — if you already run self-hosted Supabase and don't want to disturb a live stack:

```bash
bash integrate.sh /path/to/your/supabase/docker
```

This replaces only the Studio container. Your Postgres data, Auth users, and Storage buckets are completely untouched. Roll back at any time by dropping the overlay.

**Import an external stack** — if you have a separate Supabase deployment on another machine or port that you want visible in the same dashboard:

```bash
curl -s http://localhost:8000/api/platform/projects/import \
  -H 'Content-Type: application/json' \
  -d '{
    "name":           "Staging Server",
    "public_url":     "http://192.168.1.50:8000",
    "db_host":        "192.168.1.50",
    "db_password":    "...",
    "service_key":    "...",
    "jwt_secret":     "..."
  }'
```

The project appears in the switcher immediately — no restart required.

## Why not just use Supabase Cloud?

You might not have a choice. Regulated industries, air-gapped environments, data residency requirements, or simply wanting to avoid another SaaS dependency are all legitimate reasons to run your own stack. Multi-Head Studio is built for those situations — it gives you the same multi-project UX you'd get from the hosted dashboard, but entirely within your own infrastructure.

It's also useful in scenarios where Cloud would be overkill: local development environments with multiple isolated databases, an agency managing several client projects on a single VPS, or a homelab running separate stacks for different household services.

## What's the same, what's different

The UI is the full official Supabase Studio. Every feature you'd use on `supabase.com/dashboard` is present: Table Editor, SQL Editor, Auth management, Storage browser, Edge Functions, API documentation, database migrations, role and policy management. Nothing was stripped out.

The difference is purely in the project lifecycle layer: instead of Supabase Cloud's backend handling provisioning, the project switcher in the top-left now talks to a local orchestrator that runs Docker Compose.

## Get it

The image is published to GitHub Container Registry:

```bash
docker pull ghcr.io/flamingrubberduck/supabase-studio-multi-head:latest
```

Source and full documentation (including Linux bridge IP setup, port conflict resolution, and how to build from source): `github.com/flamingrubberduck/supabase-studio-multi-head`
