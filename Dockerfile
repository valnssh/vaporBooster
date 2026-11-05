# Build stage
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS builder
WORKDIR /app

# Enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Install dependencies
ENV CI=true
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source files
COPY . .

# Build without credentials, database access or Steam startup.
RUN pnpm build

FROM builder AS sqlite-importer
USER node
ENTRYPOINT ["node", "scripts/import-sqlite.mjs"]

# Production stage
FROM denoland/deno:2.9.8@sha256:a0d88a7fcbd44f062cba2748e19df67d30290ad12aa203c7c1e0b12462c483f0
LABEL org.opencontainers.image.version="0.0.5"
USER root
WORKDIR /app
RUN mkdir -p /data && chown deno:deno /data

# Copy only what's needed for runtime
COPY --from=builder --chown=deno:deno /app/package.json ./package.json
COPY --from=builder --chown=deno:deno /app/node_modules ./node_modules
COPY --from=builder --chown=deno:deno /app/.deno-deploy ./.deno-deploy
COPY --from=builder --chown=deno:deno /app/drizzle/postgresql ./drizzle/postgresql
COPY --from=builder --chown=deno:deno /app/scripts/start.ts /app/scripts/https.mjs /app/scripts/postgres.mjs /app/scripts/migrations.mjs /app/scripts/migrate.mjs ./scripts/
ENV HOST=0.0.0.0 PORT=8443 BETTER_AUTH_TELEMETRY=0 DENO_DIR=/tmp/deno LEGACY_SQLITE_FILE=/data/sqlite.db
USER deno

# Expose only the TLS listener; Compose publishes it on HTTPS port 443.
EXPOSE 8443

# Run with Deno
CMD ["deno", "run", "--cached-only", "--no-prompt", "--allow-env", "--allow-net", "--allow-sys", "--allow-read=/app,/data,/run/tls", "--allow-write=/data", "scripts/start.ts"]
