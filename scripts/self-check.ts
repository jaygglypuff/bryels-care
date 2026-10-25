/**
 * Start-up self-check (scripts/start.sh, ADR-055): prints plain-language "[setup]" lines about the
 * Railway variables and exits 1 only when the process cannot work at all (no usable DATABASE_URL).
 * Usage: pnpm self-check [web|worker]
 */
import "dotenv/config";
import { formatNotes, selfCheck, type Service } from "../src/lib/runtime-env";

const arg = process.argv.slice(2).find((a) => a === "web" || a === "worker") as Service | undefined;
const { fatal, notes } = selfCheck(process.env, arg ?? "web");
for (const line of formatNotes(notes)) console.log(line);
if (fatal) {
  console.log("[setup] PROBLEM  The app cannot start until the setting above is fixed. After you change a variable, press Deploy on the banner Railway shows to apply it.");
  process.exit(1);
}
