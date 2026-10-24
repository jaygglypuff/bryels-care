/**
 * Go-live migration loader (US-2-25, docs/data-migration-plan.md §9.4). Thin command-line front end of the
 * import engine in src/modules/imports (same validation, duplicate rules, error file and audit as the wizard).
 *
 *   pnpm migrate:load --kind materials --file ./materials.xlsx --site NFD --as clerk@example.com
 *   pnpm migrate:approve IMP-2611-001 --as manager@example.com
 *   pnpm migrate:load --post --job IMP-2611-001 --as manager@example.com
 *
 * Refuses production unless MIGRATION_WINDOW_OPEN=true; --post also needs the read-only maintenance mode on
 * (docs/operations-runbook.md §17a.2). The password is read from the terminal without echo.
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

function prompt(question: string, opts: { secret: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY && opts.secret) return reject(new Error("The loader needs an interactive terminal to ask for the password."));
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WriteStream };
    if (opts.secret) out._writeToOutput = (s: string) => out.output.write(s.startsWith(question) ? question : "");
    rl.question(question, (answer) => {
      rl.close();
      if (opts.secret) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const { parseLoaderArgs, runLoader } = await import("../src/modules/imports/loader");
  const argv = process.argv.slice(2);
  const args = parseLoaderArgs(argv);
  return runLoader(args, {
    env: { APP_ENV: process.env.APP_ENV, MIGRATION_WINDOW_OPEN: process.env.MIGRATION_WINDOW_OPEN },
    readFile: async (p) => new Uint8Array(await readFile(p)),
    writeFile: (p, b) => writeFile(p, b, { flag: "wx" }),
    prompt,
    log: (l) => console.log(l),
  });
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
