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

| Variable    | Default                    | Description          |
|-------------|----------------------------|----------------------|
| `STUDIO_URL`| `http://localhost:8082`    | Studio base URL      |

## Commands

```
smh list                list all projects
smh create <name>       create and start a new project
smh delete <ref>        stop containers and remove project
smh start  <ref>        start a stopped project
smh stop   <ref>        stop a running project
smh status <ref>        show registry record (URLs, keys, ports)
smh health [ref]        live container health (omit ref for all projects)
```

## Examples

```sh
# Create a new project
smh create "my-app"

# Check all container health
smh health

# Tail a specific project
smh health my-app

# Point at a remote Studio
STUDIO_URL=http://192.168.1.10:8082 smh list
```
