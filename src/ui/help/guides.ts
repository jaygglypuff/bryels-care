import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * In-app quick guides (US-2-27, FR-platform-16). Content is versioned markdown in the repository
 * (`docs/help/<file>.md`, front matter `key`, `title`, `version`, `updated_at`, `sop`), reviewed
 * like code: the author opens the change and a second person approves it before it ships
 * (A-W2F-06; the database `help_guides` editor of AC2 is deferred). Reading needs no permission.
 */
export type GuideBlock = { kind: "h"; text: string; id: string } | { kind: "p"; text: string } | { kind: "ol" | "ul"; items: string[] };
export type Guide = { key: string; title: string; version: number; updatedAt: string; sop: string | null; blocks: GuideBlock[] };

/** Screen key → file in docs/help. */
export const GUIDE_FILES: Record<string, string> = {
  // ADR-088 grade-5 help: one "your day in 5 steps" guide per role, and the glossary
  "role.owner": "role-owner.md",
  "role.site_manager": "role-site-manager.md",
  "role.operator": "role-operator.md",
  "role.warehouse": "role-warehouse.md",
  "role.qa": "role-qa.md",
  "start.words": "words.md",
  // ADR-072: the end-to-end walkthrough for the empty sandbox company (listed first on /help)
  "start.getting_started": "getting-started.md",
  // ADR-075: codes, locations, deleting drafts, To approve, notifications
  "start.everyday_basics": "everyday-basics.md",
  "inventory.receive": "receive.md",
  "inventory.move": "move.md",
  "inventory.count": "count.md",
  // Wave 4 W4F (US-9-08): one quick guide per major flow
  "inventory.putaway": "putaway.md",
  // ADR-099: labels printed where the work happens, which label goes where, scanning
  "inventory.labels": "labels.md",
  // ADR-074: the production order (one order from ordering to done, daily log, defects)
  "production.production_order": "production-order.md",
  "production.work_order": "work-order.md",
  "production.staging": "staging.md",
  "production.weighing": "weighing.md",
  "production.line_clearance": "line-clearance.md",
  // ADR-080 stage G2: the production flow v2 operator screens
  "production.materials_list": "materials-list.md",
  "production.weigh": "weigh.md",
  "production.step": "step.md",
  "quality.release": "qa-release.md",
  // ADR-080 G3: Finish batch and Check quality
  "production.finish": "finish.md",
  "quality.check": "check-quality.md",
  "production.bmr": "bmr.md",
  "sales.order": "order.md",
  "sales.fulfilment": "pick-pack-dispatch.md",
  "quality.complaint": "complaint.md",
  "sales.return": "return.md",
  "platform.import": "import.md",
  "analytics.reports": "run-a-report.md",
  // ADR-076: Master data → Lists
  "masterdata.lists": "lists.md",
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Parses the small markdown subset the guides use: `##` headings, paragraphs, numbered and bulleted lists, **bold**. */
export function parseGuide(source: string, fallbackKey = "unknown"): Guide {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const meta: Record<string, string> = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const body = m ? source.slice(m[0].length) : source;
  const blocks: GuideBlock[] = [];
  let para: string[] = [];
  let list: { kind: "ol" | "ul"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "h", text: h[1], id: slug(h[1]) });
    } else if (ol || ul) {
      const kind = ol ? "ol" : "ul";
      if (para.length) flush();
      if (!list || list.kind !== kind) {
        if (list) blocks.push(list);
        list = { kind, items: [] };
      }
      list.items.push((ol ?? ul)![1]);
    } else if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return {
    key: meta.key ?? fallbackKey,
    title: meta.title ?? fallbackKey,
    version: Number(meta.version ?? 1),
    updatedAt: meta.updated_at ?? "",
    sop: meta.sop ?? null,
    blocks,
  };
}

/** The published guide for a screen key, or null when there is none ("No guide for this screen yet"). */
export function loadGuide(key: string): Guide | null {
  const file = GUIDE_FILES[key];
  if (!file) return null;
  try {
    return parseGuide(readFileSync(path.join(process.cwd(), "docs", "help", file), "utf8"), key);
  } catch {
    return null;
  }
}

export function listGuides(): Guide[] {
  return Object.keys(GUIDE_FILES)
    .map((k) => loadGuide(k))
    .filter((g): g is Guide => !!g);
}

/** The five role guides on /help, in menu order, with the role codes each one is for (ADR-088). */
export const ROLE_GUIDES: { key: string; label: string; roles: string[] }[] = [
  { key: "role.owner", label: "Owner", roles: ["owner_director"] },
  { key: "role.site_manager", label: "Site manager", roles: ["site_manager", "production_planner", "system_admin", "finance", "sales_cs", "procurement", "auditor"] },
  { key: "role.operator", label: "Machine operator", roles: ["production_operator"] },
  { key: "role.warehouse", label: "Warehouse", roles: ["warehouse_operator"] },
  { key: "role.qa", label: "QA", roles: ["qa_qc"] },
];

/** Task guides: everything that is not a role guide or the glossary (still opened by the "?" on each screen). */
export function listTaskGuides(): Guide[] {
  const skip = new Set([...ROLE_GUIDES.map((r) => r.key), "start.words"]);
  return listGuides().filter((g) => !skip.has(g.key));
}
