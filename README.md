# Supabase Studio — Multi-Head Fork

A self-hosted Supabase dashboard that manages **multiple isolated Supabase projects** from a single Studio instance. Each project gets its own Docker Compose stack with dedicated Postgres, GoTrue, Storage, and Kong containers.

Built on top of [Supabase Studio](https://github.com/supabase/supabase/tree/master/apps/studio) with:

- [Next.js](https://nextjs.org/)
- [Tailwind](https://tailwindcss.com/)

## Multi-Head features

| Feature | Description |
|---|---|
| **Multiple projects** | Spin up isolated Supabase stacks with one click or one CLI command |
| **Organizations** | Group projects into organizations with role-based access |
| **OAuth setup** | View GoTrue callback URLs for every project in one place |
| **Storage** | See storage API endpoints across all projects |
| **Migrations** | Compare migration state across all projects simultaneously |
| **Import from Cloud** | Migrate a Supabase Cloud database to a self-hosted project |
| **Read replicas** | Add streaming replicas to any project [Business] |
| **Warm standby** | Automatic failover with a hot standby [Business] |
| **Cluster mode** | Multi-node read scaling [Enterprise] |

## Migrate from Supabase Cloud

Move an existing Supabase Cloud database to a self-hosted project in a few steps.

### In the Studio UI

1. Go to **Projects → Import from Cloud**
2. Enter your cloud project's **direct** database connection string
   - Find it under: *Project Settings → Database → Connection string → URI*
   - Use `db.<ref>.supabase.co:5432` — not the pooler URL
3. Select the target self-hosted project
4. Choose which schemas to migrate (default: `public`)
5. Optionally check **Schema only** to skip row data
6. Click **Next**, review the warning, then **Run migration**

The migration runs `pg_dump` inside the target project's Postgres container and streams the output directly into that project's database. Progress is shown in a live log panel.

### Via the CLI

```bash
# Migrate schema + data (public schema only)
smh migrate <ref> --source "postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"

# Schema only
smh migrate <ref> --source "postgresql://..." --schema-only

# Include additional schemas (e.g. auth users)
smh migrate <ref> --source "postgresql://..." --schemas public,auth
```

> **Note:** The target project must be running and healthy before migrating. Existing objects in the selected schemas will be dropped and recreated.

## CLI reference (`smh`)

```
smh list                              list all projects
smh create <name>                     create a new project
smh rename <ref> <name>               rename a project
smh delete <ref>                      delete a project
smh start  <ref>                      start a stopped project
smh stop   <ref>                      stop a running project
smh status <ref>                      show project details
smh health [ref]                      show live container health

smh org list                          list organizations
smh org create <name>                 create an organization
smh org rename <slug> <name>          rename an organization

smh member list   <org-slug>          list org members
smh member add    <org-slug> <email>  --role <role> [--password <pw>]
smh member remove <org-slug> <id>     remove a member

smh oauth-urls [ref]                  print OAuth callback URLs
smh storage    [ref]                  print storage API URLs
smh migrations <ref>                  list applied migrations
smh migrations compare                compare migration state across all projects

smh migrate <ref> --source <db-url>   migrate from Supabase Cloud
  [--schemas public,auth]             schemas to include (default: public)
  [--schema-only]                     skip row data

smh replica add    <ref> [--host H]   add a read replica      [Business]
smh replica remove <ref> <replica>    remove a replica
smh standby add    <ref> [--host H]   add a warm standby      [Business]
smh standby remove <ref>              remove the standby
smh failover         <ref>            trigger failover        [Business]
smh cluster-failover <ref>            promote highest replica [Enterprise]

smh license status                    show license tier
smh license activate <key>            activate a license key
smh license deactivate                revert to free tier

smh overlay                           list optional component profiles and compose commands
```

**Environment variables:**

```bash
STUDIO_URL=http://localhost:8000   # Studio base URL
DASHBOARD_USERNAME=supabase        # Basic auth username
DASHBOARD_PASSWORD=<password>      # Basic auth password
```

---

## Lean / minimal deployment

`docker/docker-compose.minimal.yml` converts every optional service to opt-in via Docker Compose profiles. Run it when you want a lighter stack or don't need every component.

```bash
# Core stack only (db, auth, rest, kong, studio, meta)
docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d

# Add components back selectively
docker compose -f docker-compose.yml -f docker-compose.minimal.yml \
  --profile storage --profile realtime up -d
```

| Profile | Enables |
|---------|---------|
| `realtime` | Realtime WebSocket subscriptions |
| `storage` | Storage API + imgproxy image transformations |
| `edge-functions` | Edge Functions (Deno runtime) |
| `pooler` | Supavisor connection pooler (ports 5432 / 6543) |
| `analytics` | Logflare + Vector log pipeline |

Can be combined with other overlays. Use `smh overlay` to print ready-to-run compose commands.

---

## What's included

Studio is designed to work with existing deployments - either the local hosted, docker setup, or our CLI. It is not intended for managing the deployment and administration of projects - that's out of scope.

As such, the features exposed on Studio for existing deployments are limited to those which manage your database:

- Table & SQL editors
  - Saved queries are unavailable
- Database management
  - Policies, roles, extensions, replication
- API documentation

## Managing Project Settings

Project settings are managed outside of the Dashboard. If you use docker compose, you should manage the settings in your docker-compose file. If you're deploying Supabase to your own cloud, you should store your secrets and env vars in a vault or secrets manager.

## How to contribute?

- Branch from `master` and name your branches with the following structure
  - `{type}/{branch_name}`
    - Type: `chore | fix | feature`
    - The branch name is arbitrary — just make sure it summarizes the work.
- When you send a PR to `master`, it will automatically tag members of the frontend team for review.
- Review the [contributing checklists](contributing/contributing-checklists.md) to help test your feature before sending a PR.
- The Dashboard is under active development. You should run `git pull` frequently to make sure you're up to date.

### Developer Quickstart

> [!NOTE]  
> **Supabase internal use:** To develop on Studio locally with the backend services, see the instructions in the [internal `infrastructure` repo](https://github.com/supabase/platform/blob/develop/docs/contributing.md).

```bash
# You'll need to be on Node v20
# in /studio

## For external contributors
pnpm install # install dependencies
pnpm run dev # start dev server

## For internal contributors
## First clone the private supabase/platform repo and follow instructions for setting up mise
mise studio  # Run from supabase/platform alongside `mise infra`

## For all
pnpm run test # run tests
pnpm run test -- --watch # run tests in watch mode
```

## Running within a self-hosted environment

Follow the [self-hosting guide](https://supabase.com/docs/guides/hosting/docker) to get started.

```
cd ..
cd docker
docker compose -f docker-compose.yml -f ./dev/docker-compose.dev.yml up
```

Once you've got that set up, update `.env` in the studio folder with the corresponding values.

```
POSTGRES_PASSWORD=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
```

Then run the following commands to install dependencies and start the dashboard.

```
npm install
npm run dev
```

If you would like to configure different defaults for "Default Organization" and "Default Project", you will need to update the `.env` in the studio folder with the corresponding values.

```
DEFAULT_ORGANIZATION_NAME=
DEFAULT_PROJECT_NAME=
```
