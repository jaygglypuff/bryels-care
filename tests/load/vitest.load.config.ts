import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Posting-time harness (US-9-01, docs/testing.md §11.1 "Posting command server time"): runs
 * tests/load/*.load.ts against a SCRATCH database grown by `pnpm load:seed`, never the test database.
 *   LOAD_DATABASE_URL=postgres://…/bryels_load_<you> pnpm load:postings
 */
const url = process.env.LOAD_DATABASE_URL ?? "";
if (!/load|perf|scratch/i.test(url)) throw new Error("Set LOAD_DATABASE_URL to a scratch database whose name contains load, perf or scratch.");

const root = path.resolve(__dirname, "../..");
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/load/**/*.load.ts"],
    root,
    fileParallelism: false,
    testTimeout: 1_800_000,
    hookTimeout: 600_000,
    env: { DATABASE_URL: url, LOAD_DATABASE_URL: url },
  },
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      "server-only": path.join(root, "tests/support/empty.ts"),
      "next/headers": path.join(root, "tests/support/next-headers.ts"),
      "next/navigation": path.join(root, "tests/support/next-navigation.ts"),
    },
  },
});
