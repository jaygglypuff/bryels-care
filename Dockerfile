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
