FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update -qq && \
  apt-get install -y --no-install-recommends \
  git \
  python3 \
  ca-certificates \
  build-essential && \
  rm -rf /var/lib/apt/lists/* && \
  update-ca-certificates

RUN npm install -g pnpm@10.24.0

WORKDIR /app

# Install dependencies
# Copy workspace manifests first for better layer caching
FROM base AS deps
COPY .npmrc pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY patches/ ./patches/
COPY packages/ ./packages/
RUN pnpm install --no-frozen-lockfile

# Compile Next.js
FROM deps AS builder
ENV NODE_OPTIONS="--max_old_space_size=3584"
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN SKIP_ASSET_UPLOAD=1 pnpm run build

# Production image — copy only compiled standalone output
FROM base AS production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=5s --retries=3 CMD node -e "fetch('http://localhost:3000/api/platform/profile').then((r) => {if (r.status !== 200) throw new Error(r.status)})"
CMD ["node", "server.js"]
