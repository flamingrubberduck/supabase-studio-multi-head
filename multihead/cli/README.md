# smh — Supabase Multi-Head CLI

A zero-dependency CLI for managing projects in your self-hosted Supabase Multi-Head Studio.  
Requires Node 18+ (uses built-in `fetch`).

## Setup

```sh
# Make executable (Linux / macOS / WSL)
chmod +x multihead/cli/smh.mjs

# Optional: symlink onto your PATH
ln -s "$PWD/multihead/cli/smh.mjs" /usr/local/bin/smh
```

On Windows (PowerShell / Git Bash), invoke it directly:
```sh
node multihead/cli/smh.mjs list
```

## Environment

| Variable             | Default                   | Description               |
|----------------------|---------------------------|---------------------------|
| `STUDIO_URL`         | `http://localhost:8000`   | Studio base URL           |
| `DASHBOARD_USERNAME` | —                         | Basic auth username       |
| `DASHBOARD_PASSWORD` | —                         | Basic auth password       |

## Commands

### Project management

```
smh list                    list all projects
smh rename <ref> <name>     rename a project
smh delete <ref>            stop containers and remove project
smh start  <ref>            start a stopped project
smh stop   <ref>            stop a running project
smh status <ref>            show registry record (URLs, keys, ports)
smh health [ref]            live container health (omit ref for all projects)
```

#### Creating projects

```
smh create <name>
  [--mode stack]                             full Docker Compose stack (default)
  [--mode embedded]                          new Postgres DB inside the default instance
  [--mode embedded --target <ref>]           new Postgres DB inside a specific project's Postgres
  [--mode pocketbase]                        PocketBase via Docker Compose
  [--mode pocketbase-embedded]               PocketBase via plain docker run (no Compose)
  [--mode pocketbase-embedded --target <ref>] PocketBase collection namespace inside existing PB
  [--host <docker_host>]                     remote Docker daemon (ssh://user@host or tcp://host:2376)
```

**Examples:**
```sh
# Default full Supabase stack
smh create "my-app"

# Embedded database inside the default Postgres (no new containers)
smh create "my-db" --mode embedded

# Embedded database inside a specific project's Postgres
smh create "my-db" --mode embedded --target abc123

# PocketBase via Docker Compose
smh create "my-pb" --mode pocketbase

# PocketBase via plain docker run
smh create "my-pb" --mode pocketbase-embedded

# PocketBase collection namespace inside an existing PocketBase project
smh create "my-ns" --mode pocketbase-embedded --target def456

# On a remote Docker host
smh create "my-app" --host ssh://user@192.168.1.10
```

### Organization management

```
smh org list                         list all organizations
smh org create <name>                create a new organization
smh org rename <slug> <name>         rename an organization
```

### Member management

```
smh member list   <org-slug>                              list members
smh member add    <org-slug> <email> --role <role>        add a member
  [--password <pw>]                                       set initial password
smh member remove <org-slug> <gotrue_id>                  remove a member

Roles: owner | administrator | developer | readonly
```

### Backups

```
smh backup list     <ref>                          list backups and current schedule
smh backup run      <ref>                          trigger a pg_dump backup now
smh backup schedule <ref> daily|weekly|off         set automatic backup schedule
smh backup restore  <ref> <filename> --confirm     restore database from a backup
smh backup delete   <ref> <filename>               delete a backup file
smh backup download <ref> <filename> [--out <path>] download backup to local file
```

### Migrate from Supabase Cloud

```
smh migrate <ref> --source <db-url>         dump cloud DB → restore into self-hosted project
  [--schemas public,auth]                   schemas to include (default: public)
  [--schema-only]                           skip row data
smh migrate resume <ref> <job-id>           resume an interrupted migration (restore phase only)
```

Get the source URL from: *Project Settings → Database → Connection string → URI* (use the direct `db.<ref>.supabase.co` URL, not the pooler).

### PocketBase migration

Bi-directional data migration between a PocketBase instance and a Supabase project.

```
smh pb-migrate <ref> --direction pb-to-supa|supa-to-pb
  --pb-url      <url>       PocketBase public URL (e.g. http://localhost:8090)
  --pb-email    <email>     PocketBase admin email
  --pb-password <password>  PocketBase admin password

smh pb-migrate status <ref> --job <job-id>   poll a running migration job
```

**Examples:**
```sh
# Migrate PocketBase data → Supabase project
smh pb-migrate abc123 \
  --direction pb-to-supa \
  --pb-url http://localhost:8090 \
  --pb-email admin@example.com \
  --pb-password mypassword

# Check migration status
smh pb-migrate status abc123 --job mig_1234567890
```

### Setup helpers

```
smh oauth-urls [ref]         print GoTrue callback URLs for OAuth providers
smh storage    [ref]         print storage API URLs per project
smh migrations <ref>         list applied migrations on a project
smh migrations compare       show migration state across all projects side-by-side
```

### Cluster & failover

```
smh replica add    <ref> [--host H]    provision a read replica       [Business]
smh replica remove <ref> <replica>     remove a read replica
smh standby add    <ref> [--host H]    provision a warm standby       [Business]
smh standby remove <ref>               remove the standby
smh failover         <ref>             trigger primary → standby failover  [Business]
smh cluster-failover <ref>             promote highest-rank healthy replica [Enterprise]
```

### License

```
smh license status              show current license tier
smh license activate <key>      activate a license key
smh license deactivate          revert to free tier
```

### Optional components

```
smh overlay                          list profiles and print compose command (core only)
smh overlay <profile>...             enable selected profiles + print command
smh overlay <profile>... --run       also execute the compose command

Profiles: realtime  storage  edge-functions  pooler  analytics
```
