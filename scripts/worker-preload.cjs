/**
 * Preloaded by `pnpm worker` (node --require). Domain modules start with `import "server-only"`,
 * a guard that throws outside the Next.js server bundle. The worker is a server process, so the
 * guard resolves to an empty module here, exactly as vitest does (vitest.config.ts alias).
 */
const Module = require("node:module");
const path = require("node:path");

const empty = path.join(__dirname, "server-only-empty.cjs");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return empty;
  return resolve.call(this, request, ...rest);
};
