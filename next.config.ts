import { randomUUID } from "node:crypto";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2"],
  poweredByHeader: false,
  // W2F: quick guides (US-2-27) and the migration journal (diagnostics Health card) are read at runtime.
  outputFileTracingIncludes: { "/**": ["./docs/help/**/*", "./src/db/migrations/meta/_journal.json"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      // W4D (US-7-01): the service worker must never be served from an HTTP cache, so a new release takes over promptly.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

/**
 * W4D (US-7-01, ADR-018): Serwist builds src/app/sw.ts into public/sw.js in production builds and
 * registers it at scope "/". Disabled in development (next dev) so hot reload is never cached. The
 * static /offline page is precached with this build's revision (Railway's commit SHA when present).
 */
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  scope: "/",
  register: true,
  reloadOnOnline: false,
  cacheOnNavigation: false,
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries: [{ url: "/offline", revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? randomUUID() }],
  globPublicPatterns: ["icons/**/*"],
});

export default withSerwist(nextConfig);
