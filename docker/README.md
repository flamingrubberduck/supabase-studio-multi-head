# Self-Hosted Supabase with Docker

This is the official Docker Compose setup for self-hosted Supabase. It provides a complete stack with all Supabase services running locally or on your infrastructure.

## Getting Started

Follow the detailed setup guide in our documentation: [Self-Hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)

The guide covers:
- Prerequisites (Git and Docker)
- Initial setup and configuration
- Securing your installation
- Accessing services
- Updating your instance

## What's Included

This Docker Compose configuration includes the following services:

- **[Studio](https://github.com/supabase/supabase/tree/master/apps/studio)** - A dashboard for managing your self-hosted Supabase project
- **[Kong](https://github.com/Kong/kong)** - Kong API gateway
- **[Auth](https://github.com/supabase/auth)** - JWT-based authentication API for user sign-ups, logins, and session management
- **[PostgREST](https://github.com/PostgREST/postgrest)** - Web server that turns your PostgreSQL database directly into a RESTful API
- **[Realtime](https://github.com/supabase/realtime)** - Elixir server that listens to PostgreSQL database changes and broadcasts them over websockets
- **[Storage](https://github.com/supabase/storage)** - RESTful API for managing files in S3, with Postgres handling permissions
- **[imgproxy](https://github.com/imgproxy/imgproxy)** - Fast and secure image processing server
- **[postgres-meta](https://github.com/supabase/postgres-meta)** - RESTful API for managing Postgres (fetch tables, add roles, run queries)
- **[PostgreSQL](https://github.com/supabase/postgres)** - Object-relational database with over 30 years of active development
- **[Edge Runtime](https://github.com/supabase/edge-runtime)** - Web server based on Deno runtime for running JavaScript, TypeScript, and WASM services
- **[Logflare](https://github.com/Logflare/logflare)** - Log management and event analytics platform
- **[Vector](https://github.com/vectordotdev/vector)** - High-performance observability data pipeline for logs
- **[Supavisor](https://github.com/supabase/supavisor)** - Supabase's Postgres connection pooler

## Documentation

- **[Documentation](https://supabase.com/docs/guides/self-hosting/docker)** - Setup and configuration guides
- **[CHANGELOG.md](./CHANGELOG.md)** - Track recent updates and changes to services
- **[versions.md](./versions.md)** - Complete history of Docker image versions for rollback reference

## Updates

To update your self-hosted Supabase instance:

1. Review [CHANGELOG.md](./CHANGELOG.md) for breaking changes
2. Check [versions.md](./versions.md) for new image versions
3. Update `docker-compose.yml` if there are configuration changes
4. Pull the latest images: `docker compose pull`
5. Stop services: `docker compose down`
6. Start services with new configuration: `docker compose up -d`

**Note:** Consider to always backup your database before updating.

## Community & Support

For troubleshooting common issues, see:
- [GitHub Discussions](https://github.com/orgs/supabase/discussions?discussions_q=is%3Aopen+label%3Aself-hosted) - Questions, feature requests, and workarounds
- [GitHub Issues](https://github.com/supabase/supabase/issues?q=is%3Aissue%20state%3Aopen%20label%3Aself-hosted) - Known issues
- [Documentation](https://supabase.com/docs/guides/self-hosting) - Setup and configuration guides

Self-hosted Supabase is community-supported. Get help and connect with other users:

- [Discord](https://discord.supabase.com) - Real-time chat and community support
- [Reddit](https://www.reddit.com/r/Supabase/) - Official Supabase subreddit

Share your self-hosting experience:

- [GitHub Discussions](https://github.com/orgs/supabase/discussions/39820) - "Self-hosting: What's working (and what's not)?"

## Reverse Proxy

Two overlay files are provided for TLS termination. Use one, not both.

### Caddy (recommended)

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Set `PROXY_DOMAIN`, `DASHBOARD_USERNAME`, and `DASHBOARD_PASSWORD` in `.env`. Caddy handles certificate provisioning automatically.

### Nginx + Certbot

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d
```

Set `PROXY_DOMAIN` and `CERTBOT_EMAIL` in `.env`.

---

## Authelia (optional 2FA/SSO)

Add two-factor authentication and single sign-on to any nginx deployment via [Authelia](https://www.authelia.com/).

### Setup

**1. Add secrets to `.env`:**

```dotenv
AUTHELIA_JWT_SECRET=<openssl rand -hex 32>
AUTHELIA_SESSION_SECRET=<openssl rand -hex 32>
AUTHELIA_STORAGE_ENCRYPTION_KEY=<openssl rand -hex 32>
AUTHELIA_SCHEMA=authelia
```

**2. Update `volumes/authelia/configuration.yml`** — replace `supabase.example.com` and `example.com` with your actual domain.

**3. Start the stack** (use `docker-compose.nginx-authelia.yml` instead of `docker-compose.nginx.yml`):

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.nginx-authelia.yml \
  -f docker-compose.authelia.yml \
  up -d
```

**4. Create users:**

```bash
# Generate a bcrypt hash for the password
docker exec supabase-authelia authelia crypto hash generate bcrypt --password yourpassword

# Create volumes/authelia/users_database.yml
cat > volumes/authelia/users_database.yml <<'EOF'
users:
  your_username:
    disabled: false
    displayname: "Your Name"
    password: "$2b$12$<hash from above>"
    email: you@example.com
    groups:
      - admins
EOF
```

**Overlay files added:**

| File | Purpose |
|------|---------|
| `docker-compose.authelia.yml` | Authelia service + DB schema init |
| `docker-compose.nginx-authelia.yml` | Nginx overlay that uses `auth_request` instead of `auth_basic` |
| `volumes/authelia/configuration.yml` | Authelia config (edit domain before use) |
| `volumes/nginx/snippets/` | Modular nginx snippets (authelia-authrequest, authelia-location, cors, proxy headers) |
| `volumes/caddy/snippets/cors.conf` | Reusable Caddy CORS snippet |
| `volumes/db/schema-authelia.sh` | Creates the Authelia schema in Postgres on DB init |

---

## Integration tests

The `test/` directory contains a Vitest suite that exercises a running deployment end-to-end: CRUD operations via PostgREST, file storage (S3 + signed URLs), Realtime subscriptions, and Edge Functions. It validates all four API key types (`anon_key`, `service_role_key`, `publishable_key`, `secret_key`).

**Requirements:** a running deployment with `SUPABASE_PUBLIC_URL` accessible.

```bash
cd test
npm install
npm test
```

The suite reads credentials from `../docker/.env` automatically (via `vitest.config.ts`). Override any variable with env before running.

---

## Upstream update tracking

A GitHub Actions workflow (`.github/workflows/check_updates.yaml`) runs every Tuesday at 05:00 UTC. It diffs this repo's `docker/` directory against `supabase/supabase` upstream and posts a summary to Discord.

Add `DISCORD_WEBHOOK_URL` as a repository secret to enable it. Run it manually with `workflow_dispatch` at any time.

---

## Important Notes

### Security

⚠️ **The default configuration is not secure for production use.**

Before deploying to production, you must:
- Update all default passwords and secrets in the `.env` file
- Generate new JWT secrets
- Review and update CORS settings
- Use a reverse proxy (Caddy or Nginx overlay — see above) in front of self-hosted Supabase
- For production deployments requiring 2FA, enable the Authelia overlay
- Review and adjust network security configuration (ACLs, etc.)
- Set up proper backup procedures

See the [security section](https://supabase.com/docs/guides/self-hosting/docker#configuring-and-securing-supabase) in the documentation.

## License

This repository is licensed under the Apache 2.0 License. See the main [Supabase repository](https://github.com/supabase/supabase) for details.
