import type { NextConfig } from "next";

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
    ];
  },
};

export default nextConfig;
