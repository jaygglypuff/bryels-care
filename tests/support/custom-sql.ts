import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

/**
 * The custom SQL migration of a stream (`<nnnn>_<stream>_custom_sql`), looked up in the Drizzle journal so
 * drift tests survive migration renumbering. Returns the journal tag, the migration text and the canonical
 * `src/db/sql/<stream>.sql` text the migration must end with.
 */
export function customMigration(stream: string) {
  const journal = JSON.parse(readFileSync(path.join(root, "src/db/migrations/meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
  const tag = journal.entries.map((e) => e.tag).find((t) => t.endsWith(`_${stream}_custom_sql`));
  if (!tag) throw new Error(`No custom migration for ${stream} in the journal`);
  return {
    tag,
    migration: readFileSync(path.join(root, `src/db/migrations/${tag}.sql`), "utf8"),
    canonical: readFileSync(path.join(root, `src/db/sql/${stream}.sql`), "utf8"),
  };
}
