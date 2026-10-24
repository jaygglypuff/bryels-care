import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    // W2F: resetTestDatabase (migrate + seed) can exceed the 10 s default on a loaded machine.
    hookTimeout: 60000,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/bryels_test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
      "next/headers": path.resolve(__dirname, "tests/support/next-headers.ts"),
      "next/navigation": path.resolve(__dirname, "tests/support/next-navigation.ts"),
    },
  },
});
