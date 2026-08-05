# Multi-stage production Dockerfile for HorPlus-V2 Server

# --- Stage 1: Build & Dependencies ---
FROM node:22-alpine AS builder
WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files and Prisma schema
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY assets ./assets

RUN npm run build

# --- Stage 2: Runtime Environment ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Install openssl for Prisma engine runtime
RUN apk add --no-cache openssl ca-certificates

# Copy production node_modules, generated prisma client, and compiled JavaScript
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets

# Security: Create upload directories and set permissions for non-root user
RUN mkdir -p /app/uploads/private /app/uploads/public && chown -R node:node /app

# Security: Run as non-root user
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/health/liveness || exit 1

CMD ["node", "dist/server.js"]
