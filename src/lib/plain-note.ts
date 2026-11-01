/**
 * Report footnotes in plain words (UX audit C #6, round 2 part 2): the KPI catalogue's definitions and reasons
 * carry design references for engineers ("(Phase 6, A-KPI-10)", "(finance scope, ADR-020)") and a few trade
 * words. On screens for owners they are dropped or replaced; the catalogue text itself (exports, the
 * definitions page's technical name) is unchanged. Pure; unit-tested in tests/unit/no-jargon-messages.test.ts.
 */
const REF = /\s*\((?=[^()]*\b(?:ADR|A-[A-Z0-9]+|US|FR)-\d)[^()]*\)/g;
const WORDS: [RegExp, string][] = [
  [/\bBOM material requirement\b/g, "recipe ingredient"],
  [/\bBOM\b/g, "recipe"],
  [/\bdispositions?\b/gi, "QA decision"],
  [/\bquarantine\b/gi, "waiting for QA"],
  [/\bwork orders?\b/gi, "production order"],
  [/\baction-centre items\b/gi, "problems on Problems & alerts"],
];

export function plainNote(text: string | null | undefined): string {
  let t = (text ?? "").replace(REF, "");
  for (const [re, w] of WORDS) t = t.replace(re, w);
  return t.replace(/\s{2,}/g, " ").replace(/\s+([.,;])/g, "$1").trim();
}
