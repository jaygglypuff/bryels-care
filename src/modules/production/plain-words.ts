/**
 * Plain words for configured step names and instructions (UX audit 2026-10-31 item 8; ADR-080 §11 banned
 * operator words). The step setup is configuration and keeps its exact words (shown under "Exact words of
 * the step setup" and printed on the batch record); the operator screen shows this plain version. Pure.
 */
const RULES: [RegExp, string][] = [
  [/\bline[- ]clearance\b/gi, "clean-area check"],
  [/\btransfer to quarantine storage area\b/gi, "put in the hold area"],
  [/\bquarantine storage area\b/gi, "hold area"],
  [/\bquarantine\b/gi, "hold area"],
  [/\buntil QA disposition\b/gi, "until QA checks it"],
  [/\bQA disposition\b/gi, "QA decision"],
  [/\bdisposition\b/gi, "decision"],
  [/\breconcile\b/gi, "count"],
  [/\breconciliation\b/gi, "count"],
  [/\bdestroyed\b/gi, "spoiled"],
  [/\bdispensing\b/gi, "weighing"],
  [/\bdispense\b/gi, "weigh"],
  [/\bstaging\b/gi, "getting materials"],
  [/\btolerance\b/gi, "allowed difference"],
  [/\bBMR\b/g, "batch record"],
];

export function plainWords(text: string | null | undefined): string {
  let out = text ?? "";
  for (const [re, word] of RULES) out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase() ? word[0].toUpperCase() + word.slice(1) : word));
  return out;
}
