import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_KINDS } from "@/modules/action-centre/kinds";

/**
 * Plain words in what the app says to people on its own (docs/CONSULTANT_REVIEW.md §5, docs/PRD.md glossary,
 * docs/LEGACY_SCREENS.md): message titles and bodies, "To approve" and "Problems & alerts" rows, their kind
 * labels and buttons. Stored codes, permission strings, exports and printed GMP records keep their names and are
 * not scanned. The production module is reviewed with the production screens (excluded here).
 */
const ROOT = join(__dirname, "..", "..");
const MODULES = join(ROOT, "src", "modules");

/** Industry words a grade-5 reader does not know, with the plain word the screens use instead. */
const BANNED: [RegExp, string][] = [
  [/\bquarantin\w*/i, "waiting for QA check"],
  [/\bdisposition\w*/i, "QA decision"],
  [/\bdeviations?\b/i, "problem report"],
  [/\bCAPA\b/, "fix-and-prevent plan"],
  [/\ballocat\w*/i, "set aside"],
  [/\breservations?\b/i, "set aside"],
  [/\bpost(ed|ing)\b/i, "saved to stock / saved for good"],
  [/\brevers(al|ed)\b/i, "undo (kept on record)"],
  [/\bwork orders?\b/i, "production order / repair job"],
  [/\bBMR\b/, "batch record"],
  [/\bdispens\w*/i, "weigh / get materials"],
  [/\bline clearance\b/i, "clean and check the line"],
  [/\btheoretical yield\b/i, "expected amount made"],
  [/\btolerances?\b/i, "allowed difference"],
  [/\bSKU\b/, "product / sellable item"],
  [/\bGRN\b/, "delivery received"],
  [/\bgoods receipts?\b/i, "delivery received"],
  [/\bPO\b/, "purchase order"],
  [/\bRMA\b/, "customer return"],
  [/\bATP\b/, "can we deliver?"],
  [/\bFEFO\b/, "use what expires first"],
  [/\bvariances?\b/i, "difference"],
  [/\bconditional release\b/i, "OK with conditions"],
  [/\bchange control\b/i, "change request"],
  [/\bpreventive maintenance\b/i, "regular maintenance"],
  [/\bPM\b/, "regular maintenance"],
  [/\bcredit hold\b/i, "stopped for unpaid bills"],
  [/\breconciliation\b/i, "stock check / number check"],
  [/\bUoM\b/i, "unit"],
  [/\bapproved[- ]supplier list\b|\bapproved-list\b|\bASL\b/i, "suppliers we may buy from"],
  [/\bdelivery receipts? .*not acknowledged\b|\bDR\b/, "signed delivery receipt"],
  [/\bdiscrepanc\w*/i, "difference"],
  [/\bshort-close\b/i, "close with what came"],
  [/\binspections?\b/i, "quality check"],
  [/\bsales orders?\b/i, "customer order"],
  [/\bquotations?\b/i, "price offer"],
  [/\bpurchase requests?\b/i, "request to buy"],
  [/\bbackground jobs?\b/i, "automatic task"],
  [/\bdead-letter\w*/i, "failed for good"],
  [/\bKPI\b/, "report number"],
];

/**
 * Literals that are not messages to people although they sit under a scanned key: names of downloadable lists
 * (exports keep their established names, CONSULTANT_REVIEW §5) and job names shown only to IT in Diagnostics.
 */
const ALLOW = new Set([
  "CAPA register",
  "Deviations",
  "Sales orders",
  "Quotations",
  "KPI snapshots",
  "KPI reconciliation",
  "Recall customer notification list",
]);

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== "production") files(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** Files that write messages or action rows: notify calls, action-item sources and detectors, seeded messages. */
const MESSAGE_FILES = [
  ...files(MODULES).filter((p) => /notifyUsers|notifyRoles|notifyNextStep|notifyUser\(|registerActionItemSource|kind: "approval\.|openedAt:/.test(readFileSync(p, "utf8"))),
  join(ROOT, "src", "db", "seeds", "w1a.ts"),
  join(ROOT, "src", "db", "seeds", "w3a.ts"),
];

/** Reads one JS string or template literal starting at `i` (a quote); returns its text parts and the end index. */
function readLiteral(src: string, i: number): { texts: string[]; end: number } {
  const q = src[i];
  const texts: string[] = [];
  let cur = "";
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") {
      cur += src[j + 1];
      j += 2;
      continue;
    }
    if (c === q) break;
    if (q === "`" && c === "$" && src[j + 1] === "{") {
      // An expression: scan to its closing brace; string literals inside it are texts too ("Suspension").
      let depth = 1;
      let k = j + 2;
      while (k < src.length && depth > 0) {
        const d = src[k];
        if (d === '"' || d === "'" || d === "`") {
          const inner = readLiteral(src, k);
          texts.push(...inner.texts);
          k = inner.end + 1;
          continue;
        }
        if (d === "{") depth++;
        if (d === "}") depth--;
        k++;
      }
      cur += " ";
      j = k;
      continue;
    }
    cur += c;
    j++;
  }
  texts.push(cur);
  return { texts, end: j };
}

type Hit = { file: string; line: number; key: string; text: string; word: string; plain: string };

function scan(file: string, keys: string): Hit[] {
  const src = readFileSync(file, "utf8");
  const re = new RegExp(`\\b(${keys})\\s*:\\s*(?=["'\`])`, "g");
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    const { texts, end } = readLiteral(src, start);
    re.lastIndex = end + 1;
    for (const raw of texts) {
      if (ALLOW.has(raw.trim())) continue;
      // Technical names (permission strings, setting keys, snake_case codes) are not words.
      const text = raw.replace(/\b[\w-]+(?:\.[\w-]+)+\b/g, " ").replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, " ");
      for (const [b, plain] of BANNED) {
        const w = text.match(b);
        if (w) hits.push({ file: relative(ROOT, file), line: src.slice(0, m.index).split("\n").length, key: m[1], text: raw.trim().slice(0, 120), word: w[0], plain });
      }
    }
  }
  return hits;
}

describe("plain words in messages, approvals and alerts", () => {
  it("scans the files that write messages (sanity)", () => {
    const rel = MESSAGE_FILES.map((f) => relative(ROOT, f));
    expect(rel).toEqual(expect.arrayContaining(["src/modules/action-centre/detectors.ts", "src/modules/inventory/receiving.ts", "src/modules/sales/orders.ts", "src/modules/procurement/action-items.ts", "src/modules/finance/action-items.ts", "src/modules/quality/capa.ts"]));
    expect(rel.length).toBeGreaterThan(30);
  });

  it("message titles, bodies and action-row titles and details use plain words", () => {
    const hits = MESSAGE_FILES.flatMap((f) => scan(f, "title|body|detail|subject|label|actionLabel"));
    expect(hits.map((h) => `${h.file}:${h.line} ${h.key} "${h.text}" uses "${h.word}" (say: ${h.plain})`)).toEqual([]);
  });

  it("every kind of To approve / Problems & alerts row has a plain label and button", () => {
    const bad: string[] = [];
    for (const k of ACTION_KINDS) {
      for (const [field, text] of [["label", k.label], ["actionLabel", k.actionLabel]] as const) {
        for (const [b, plain] of BANNED) if (b.test(text)) bad.push(`${k.kind}.${field} "${text}" (say: ${plain})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the scanner catches a jargon word, also inside a template expression, and ignores technical names", () => {
    const fx = "x({ title: `Deviation ${n} raised`, body: `A ${ok ? \"Suspension\" : \"PO line\"} waits`, detail: \"quality.disposition.approve is needed\" });";
    const { texts } = readLiteral(fx, fx.indexOf("`A "));
    expect(texts).toEqual(["Suspension", "PO line", "A   waits"]);
    expect(BANNED.some(([b]) => b.test("Deviation  raised"))).toBe(true);
    expect("quality.disposition.approve is needed".replace(/\b[\w-]+(?:\.[\w-]+)+\b/g, " ")).not.toMatch(/disposition/);
  });
});

/** Every `new DomainError("code", "message")` literal in a module, with its line. */
function domainErrors(dir: string): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith(".ts") ? [join(d, f)] : []));
  for (const file of walk(dir)) {
    if (file.endsWith("loader.ts")) continue; // command-line tool for IT (imports/loader.ts), not a screen message
    const src = readFileSync(file, "utf8");
    const re = /new DomainError\(\s*"[a-z_]+"\s*,\s*(?=["'`])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const { texts, end } = readLiteral(src, m.index + m[0].length);
      re.lastIndex = end + 1;
      out.push({ file: relative(ROOT, file), line: src.slice(0, m.index).split("\n").length, text: texts.join(" ") });
    }
  }
  return out;
}

/** UX audit round 2 part 2: the service errors people read most (set-up, money, spreadsheet loads) in plain words. */
describe("plain words in service errors (masterdata, finance, imports)", () => {
  const WORDS: [RegExp, string][] = BANNED.filter(([b]) => ["SKU", "post", "revers", "quarantin", "goods receipt", "PO", "toleran", "UoM", "disposition"].some((w) => b.source.includes(w)));

  it("finds the error messages (sanity)", () => {
    expect(domainErrors(join(MODULES, "finance")).length).toBeGreaterThan(50);
    expect(WORDS.length).toBeGreaterThanOrEqual(8);
  });

  for (const mod of ["masterdata", "finance", "imports"]) {
    it(`${mod}: no SKU, posting, reversal, quarantine, goods receipt or PO in what people read`, () => {
      const bad: string[] = [];
      for (const e of domainErrors(join(MODULES, mod))) {
        // Error tags ("PERIOD_LOCKED:"), technical names and snake_case codes are stripped by userMessage() or are not words.
        const text = e.text.replace(/^[A-Z_]+:\s*/, "").replace(/\b[\w-]+(?:\.[\w-]+)+\b/g, " ").replace(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g, " ");
        for (const [b, plain] of WORDS) {
          const w = text.match(b);
          if (w) bad.push(`${e.file}:${e.line} "${e.text.slice(0, 100)}" uses "${w[0]}" (say: ${plain})`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

/** Old menu paths in help, hints and errors (UX audit round 2 part 2): "Management → System → Templates & labels" is gone. */
describe("menu paths in messages follow the current menu", () => {
  const OLD = [/Management → System\b/, /Templates & labels/, /\bSetup → /, /Settings › Labels/, /Settings → (Security|Maintenance|Labels)/, /Tax configuration\)/, /Reorder suggestions\)/, /Master data → Lists/, /Products and formulas\)/];
  it("no screen, hint or error names a menu path that no longer exists", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) ? [join(d, f)] : []));
    const bad: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      for (const re of OLD) {
        const m = src.match(re);
        if (m) bad.push(`${relative(ROOT, file)}: "${m[0]}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/** Receiving and purchasing words the audit found on screens (UX audit B #6, #9; round 2 part 2). */
describe("receiving and purchasing words", () => {
  it("the receipt read model and the sales guess speak plain words", () => {
    const rq = readFileSync(join(MODULES, "inventory", "receiving-queries.ts"), "utf8");
    expect(rq).not.toMatch(/awaiting procurement approval/);
    const fm = readFileSync(join(MODULES, "procurement", "forecast-math.ts"), "utf8");
    expect(fm).not.toMatch(/Insufficient history/);
    const fc = readFileSync(join(MODULES, "procurement", "forecast.ts"), "utf8");
    expect(fc).not.toMatch(/not actuals/);
    const page = readFileSync(join(ROOT, "src", "app", "(app)", "inventory", "receive", "[grId]", "page.tsx"), "utf8");
    expect(page).not.toMatch(/Create PO from this receipt/);
    expect(readFileSync(join(ROOT, "src", "ui", "record-steps.ts"), "utf8")).not.toMatch(/label: "Posted"/);
    const seed = readFileSync(join(ROOT, "src", "db", "seed.ts"), "utf8");
    expect(seed).not.toMatch(/Quarantine cage|Dispatch bay/);
  });
});

/**
 * Round 4 (UX re-audit C): counts in plain words, never "invoice(s)", "day(s)", "box(es)". Use `plural(n, "invoice")`
 * from src/lib/plural.ts. Scans every screen, message and printed paper, production, quality and maintenance included
 * (their exclusion was removed with the round 4 leftovers, 2026-11-07).
 */
describe("no \"(s)\" plurals in what people read", () => {
  /** "word(s)" followed by text (a word, punctuation, the end of a string or JSX text), not a call `fn(s)` in code. */
  const PLURAL = /[A-Za-z]{2,}\((?:s|es|ies)\)(?= [a-z]| ?[A-Z]|\.(?:\s|["'`<]|$)|:|["'`<$])(?! (?:as|in|of)\b)/;
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [join(d, f)] : []));
  const scanFiles = () => ["src/app", "src/modules", "src/ui", "src/lib", "src/db/seeds"].flatMap((d) => walk(join(ROOT, d)));

  it("the pattern finds text plurals and skips code calls", () => {
    for (const t of ["`${n} invoice(s) are late`", "{n} day(s) late", "\"Lot(s)\"", "`${n} box(es).`", "scan(s): x"]) expect(PLURAL.test(t), t).toBe(true);
    for (const t of ["includes(s));", "syncLabel(s);", "btoa(s).replace(", "map((s) => s)", "cadenceOf(s))", "structuredClone(s), keep"]) expect(PLURAL.test(t), t).toBe(false);
  });

  it("no screen, message or paper says \"(s)\"", () => {
    const bad: string[] = [];
    for (const file of scanFiles()) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // comments are for engineers
          const m = line.match(PLURAL);
          if (m) bad.push(`${relative(ROOT, file)}:${i + 1} "${m[0]}" (use plural(n, "word") from src/lib/plural.ts)`);
        });
    }
    expect(bad).toEqual([]);
  });
});
