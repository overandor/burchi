FROM node:20-alpine AS base

# Stage 1: Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --legacy-peer-deps

# Stage 2: Build the app
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_PUBLIC_DEMO=true
RUN npm run build

# Stage 3: Production runner
# Works on Hugging Face Spaces (port 7860), Fly.io (port 7860), and any Docker host.
# PORT is set by the platform; default to 7860 for HF Spaces compatibility.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_PUBLIC_DEMO=true
ENV PORT=7860
ENV HOSTNAME=0.0.0.0

# Hugging Face Spaces runs containers as UID 1000.
# node:20-alpine already has a 'node' user with UID 1000 / GID 1000.
# Use that existing user instead of creating a new one.
RUN mkdir -p /app && chown -R node:node /app

COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

# Expose 7860 (HF Spaces default)
EXPOSE 7860

CMD ["node", "server.js"]
