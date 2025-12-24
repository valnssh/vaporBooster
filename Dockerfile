# Build stage
FROM node:24-slim AS builder
WORKDIR /app

# Enable corepack and install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml ./

# Install dependencies
ENV CI=true
RUN pnpm install --frozen-lockfile

# Copy source files
COPY . .

# Run migrations and build
RUN pnpm migrate && pnpm build

# Production stage
FROM denoland/deno:latest
WORKDIR /app

# Copy only what's needed for runtime
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.deno-deploy ./.deno-deploy
COPY --from=builder /app/sqlite.db ./sqlite.db

# Expose port 8000
EXPOSE 8000

# Run with Deno
CMD ["deno", "run", "-A", "./.deno-deploy/server.ts"]
