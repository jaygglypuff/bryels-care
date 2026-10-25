# Bryel's Care ERP — production image (Railway builds this automatically; docs/railway-for-dummies.md).
# One image, two Railway services: `web` and `worker` (scripts/start.sh picks the role).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production PORT=3000
# Backup tools for the `backup` cron service only (US-9-03, docs/deployment-railway.md §9): set the Railway
# variable WITH_BACKUP_TOOLS=1 on that service (Railway passes service variables to declared build ARGs).
# pg_dump must be at least the server's major version; PG_CLIENT_MAJOR follows the Railway Postgres image
# (template default 18 as of 2026-10; pg_dump 18 also dumps 16 and 17 servers). web and worker skip this layer.
ARG WITH_BACKUP_TOOLS=0
ARG PG_CLIENT_MAJOR=18
RUN if [ "$WITH_BACKUP_TOOLS" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg age \
      && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
      && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
      && apt-get update && apt-get install -y --no-install-recommends "postgresql-client-${PG_CLIENT_MAJOR}" \
      && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./next.config.ts
# Runtime files besides the Next.js build:
# - src/ and tsconfig.json: the worker, the migrations (src/db/migrations), the seed and the admin
#   scripts run the TypeScript sources with tsx (a production dependency);
# - scripts/: start.sh, the self-check, reference data, bootstrap;
# - docs/help: the quick guides the /help pages read at runtime (src/ui/help/guides.ts).
COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY scripts ./scripts
COPY --from=build /app/docs/help ./docs/help
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# web (default): self-check, migrations, reference data, demo data when DEMO_MODE=true and the database is
# empty, then Next.js on $PORT. worker: APP_ROLE=worker (or a service named "worker") runs the background
# jobs instead; a Custom Start Command of `pnpm worker` also works (docs/deployment-railway.md §2.3).
CMD ["sh", "scripts/start.sh"]
