/**
 * Writes docs/api/v1-contract.json from src/lib/api/contract.ts (`pnpm api:contract`).
 * The contract test fails when the committed file differs from the generated one (docs-sync).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { contractDocument } from "../src/lib/api/contract";

const out = path.resolve(__dirname, "../docs/api/v1-contract.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(contractDocument(), null, 2) + "\n");
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
