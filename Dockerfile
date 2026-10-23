# Bryel's Care ERP — production image (Railway builds this automatically).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
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
# The worker (pnpm worker) runs the TypeScript sources with tsx, so the image carries src/ and tsconfig.json.
COPY tsconfig.json ./tsconfig.json
COPY src ./src
COPY scripts ./scripts
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# web (default): applies migrations, loads the fictional demo data only when ALLOW_DEMO_SEED=true, starts Next.js.
# worker: the Railway `worker` service overrides the start command with `pnpm worker` (docs/deployment-railway.md §2.2).
CMD ["sh", "scripts/start.sh"]
