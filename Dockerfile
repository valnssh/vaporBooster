FROM node:24-slim

WORKDIR /app

# Install curl/unzip for Deno and pnpm
RUN apt-get update && apt-get install -y curl unzip && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install pnpm and Deno
RUN npm install -g pnpm \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy the rest of the application
COPY . .

# Run migrations and build
RUN pnpm migrate
RUN pnpm build

# Expose port 8000
EXPOSE 8000

# Run with Deno
CMD ["pnpm", "start"]
