# Production image: `next build`, then `next start` with dev dependencies pruned.
FROM node:24-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  RELAYDESK_DB_PATH=/data/relaydesk.db \
  RELAYDESK_TRACE_FILE=0
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Run next directly so docker stop's SIGTERM reaches node, not an npx wrapper.
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
