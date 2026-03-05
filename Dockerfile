# ========================================
# Stage 1: Dependencies
# ========================================
# https://github.com/Moyucharm/model-check
# Prisma 7 requires Node.js 22.12.0+ or 20.19.0+
FROM docker.m.daocloud.io/library/node:22-alpine AS deps
WORKDIR /app

# Install dependencies for native module compilation
RUN apk add --no-cache libc6-compat python3 make g++

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install dependencies (allow better-sqlite3 native compilation)
RUN npm ci --legacy-peer-deps --ignore-scripts \
    && npm rebuild better-sqlite3

# ========================================
# Stage 1.5: Minimal Prisma CLI Runtime Deps
# ========================================
# Build a minimal dependency tree for runtime `prisma db push`.
FROM docker.m.daocloud.io/library/node:22-alpine AS prisma-cli
WORKDIR /prisma-cli

# Resolve Prisma CLI version from lockfile to avoid drift.
COPY package-lock.json ./
RUN PRISMA_VERSION="$(node -e "const fs=require('fs'); const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')); const client=lock.packages&&lock.packages['node_modules/@prisma/client']&&lock.packages['node_modules/@prisma/client'].version; process.stdout.write(client||'7.3.0')")" \
    && GRAPHMATCH_VERSION="$(node -e "const fs=require('fs'); const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')); const graphmatch=lock.packages&&lock.packages['node_modules/graphmatch']&&lock.packages['node_modules/graphmatch'].version; process.stdout.write(graphmatch||'1.1.0')")" \
    && GRAMMEX_VERSION="$(node -e "const fs=require('fs'); const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8')); const grammex=lock.packages&&lock.packages['node_modules/grammex']&&lock.packages['node_modules/grammex'].version; process.stdout.write(grammex||'3.1.12')")" \
    && printf '{\n  "name": "model-check-prisma-cli-runtime",\n  "private": true\n}\n' > package.json \
    && rm -f package-lock.json \
    && npm install --omit=dev --no-audit --no-fund "prisma@${PRISMA_VERSION}" "graphmatch@${GRAPHMATCH_VERSION}" "grammex@${GRAMMEX_VERSION}" \
    && node -e "require.resolve('prisma/build/index.js'); require.resolve('graphmatch'); require.resolve('grammex')"

# ========================================
# Stage 2: Builder
# ========================================
FROM docker.m.daocloud.io/library/node:22-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set dummy DATABASE_URL for Prisma generate (no actual connection needed)
ENV DATABASE_URL="file:/tmp/model-check.db"

# Generate Prisma client with index.ts
RUN npm run db:generate

# Build application
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ========================================
# Stage 3: Runner (Production)
# ========================================
FROM docker.m.daocloud.io/library/node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user + install su-exec for entrypoint user switching
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && apk add --no-cache su-exec

# Copy necessary files from builder
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma/schema.prisma ./prisma/schema.prisma

# Copy standalone build (includes bundled dependencies)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy minimal Prisma CLI runtime as a full project layout.
# Keep `node_modules` as an actual path segment for ESM package resolution.
COPY --from=prisma-cli --chown=nextjs:nodejs /prisma-cli ./prisma-cli

# Create data directory for SQLite with proper ownership
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Copy entrypoint script (handles permissions + DB schema init)
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# NOTE: Don't set USER here — entrypoint runs as root first,
# then switches to nextjs via su-exec

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/status || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
