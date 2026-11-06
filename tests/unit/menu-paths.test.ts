import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "@/app/(app)/nav";
import { MENU_PATHS } from "@/lib/menu-paths";

/**
 * Messages that tell people where to go quote a menu path ("Management › People, rules and settings › Labels and
 * printouts"). Every such path, whether built from src/lib/menu-paths.ts or written out in the code, must exist in the
 * menu (src/app/(app)/nav.ts): group › section › entry (or "Advanced", the fold at the end of a section), or
 * group › section, or group › entry.
 */
const GROUPS = NAV.map((g) => g.label);

/** The longest run of leading words of `text` that is one of `names` (quotes run on into the sentence). */
function leading(text: string, names: readonly string[]): string | null {
  const words = text.trim().split(/\s+/);
  for (let n = words.length; n > 0; n--) {
    const cand = words.slice(0, n).join(" ").replace(/[.,:;]+$/, "");
    // The quote stops at ")" (sentence brackets), so an entry like "Shelves and areas (set up)" arrives without it.
    const closed = cand.split("(").length > cand.split(")").length ? `${cand})` : cand;
    if (names.includes(cand) || names.includes(closed)) return cand;
  }
  return null;
}

function inMenu(quoted: string): boolean {
  const [group, ...rest] = quoted.split(" › ");
  const g = NAV.find((n) => n.label === group.trim());
  if (!g) return false;
  const sections = [...new Set(g.items.map((i) => i.section).filter((s): s is string => !!s))];
  if (rest.length === 1) return leading(rest[0], [...sections, ...g.items.map((i) => i.label)]) !== null;
  if (rest.length === 2) {
    const section = rest[0].trim();
    if (!sections.includes(section)) return false;
    return leading(rest[1], ["Advanced", ...g.items.filter((i) => i.section === section).map((i) => i.label)]) !== null;
  }
  return false;
}

const ROOT = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

describe("menu paths quoted in messages exist in the menu", () => {
  it("the shared paths (src/lib/menu-paths.ts)", () => {
    expect(MENU_PATHS.length).toBeGreaterThan(0);
    for (const p of MENU_PATHS) expect(inMenu(p), p).toBe(true);
  });

  it("every menu path written out in src/", () => {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A top-level menu word, then one or two "›" steps (up to the end of the sentence or string).
    const re = new RegExp(`(?:${GROUPS.map(esc).join("|")}) › [^\`"<{}.;)]+?(?: › [^\`"<{}.;)]+)?(?=[\`"<{}.;)]|$)`, "gm");
    const bad: string[] = [];
    let seen = 0;
    // src/lib/menu-paths.ts builds its paths from parts (its comments wrap lines); the first test checks them.
    for (const f of walk(path.join(ROOT, "src")).filter((x) => !x.endsWith(path.join("lib", "menu-paths.ts")))) {
      for (const m of readFileSync(f, "utf8").matchAll(re)) {
        seen++;
        const quoted = m[0].replace(/\s*\($/, "");
        if (!inMenu(quoted)) bad.push(`${path.relative(ROOT, f)}: ${quoted}`);
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });

  it("the old sub-menu names are no longer quoted", () => {
    const hits = walk(path.join(ROOT, "src")).filter((f) => /› (Rules and settings|People & access) ›/.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
