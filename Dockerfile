# ──────────────────────────────────────────────────────────────
#  Procurement & Vendor Management Platform — Dockerfile
#  Multi-stage: deps → test → production runtime
# ──────────────────────────────────────────────────────────────

ARG NODE_VERSION=22-alpine

# ── Stage 1: install all dependencies ────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: run tests (breaks build if tests fail) ───────────
FROM deps AS test
COPY . .
RUN npm test

# ── Stage 3: production runtime ──────────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source (not node_modules)
COPY db/ ./db/
COPY srv/ ./srv/
COPY public/ ./public/
COPY index.js .

# SQLite persists here — mount a Docker volume at runtime
VOLUME ["/app/db"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

CMD ["node", "index.js"]
