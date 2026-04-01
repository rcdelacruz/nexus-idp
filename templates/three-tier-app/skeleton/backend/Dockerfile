# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --ignore-scripts

COPY tsconfig.json ./
COPY src/ src/
COPY migrations/ migrations/
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache tini
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser

COPY --from=builder /app/dist dist/
COPY --from=builder /app/migrations migrations/
COPY --from=builder /app/node_modules node_modules/
COPY package.json ./

ENV NODE_ENV=production
USER appuser
EXPOSE ${{ values.backendPort }}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
