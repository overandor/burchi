FROM node:22-slim AS base

# Install build tools for native modules (better-sqlite3) and procps for health checks
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
ENV npm_config_build_from_source=true
RUN npm ci --legacy-peer-deps

# Stage 2: Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_PUBLIC_DEMO=true
# Increase Node heap size to avoid OOM during type checking
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# Stage 3: Production runner
# Works on Hugging Face Spaces (port 7860), Fly.io (port 7860), and any Docker host.
# PORT is set by the platform; default to 7860 for HF Spaces compatibility.
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_PUBLIC_DEMO=true
ENV PORT=7860
ENV HOSTNAME=0.0.0.0

# Keep build tools as a fallback, but better-sqlite3 has glibc prebuilds for Debian
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*

# Debian/Ubuntu (glibc) has prebuilt better-sqlite3 binaries; no rebuild needed.
# Make sure data directory exists for SQLite persistence.
RUN mkdir -p /app/data

# Ensure writable data directory and a node user to own the app
RUN mkdir -p /app/data && chown -R node:node /app

# Copy the standalone build (includes node_modules with better-sqlite3)
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Verify the native binary loads before runtime
RUN node -e "require('better-sqlite3')" || (echo 'better-sqlite3 native binary missing/invalid' && exit 1)

USER node

# Expose 7860 (HF Spaces default)
EXPOSE 7860

CMD ["node", "server.js"]
