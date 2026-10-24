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
  "inventory.receive": "receive.md",
  "inventory.move": "move.md",
  "inventory.count": "count.md",
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
