/**
 * How serious, in plain words (round 5 leftovers, ADR-132 §9; C report B19): the stored levels of problem reports
 * and complaints (`quality.deviation.severity_levels`, `quality.complaint.severity_levels`, default minor / major /
 * critical) are shown as "Small", "Big", "Very serious". The levels themselves are company QA configuration
 * (A-W2C-02, A-W3F-02); a level the company adds is shown with its words spaced out ("needs_lab" → "Needs lab").
 * Pure; unit-tested.
 */
const WORDS: Record<string, string> = { minor: "Small", major: "Big", critical: "Very serious" };

export function severityWords(level: string | null | undefined): string {
  if (!level) return "";
  const w = WORDS[level];
  if (w) return w;
  const spaced = level.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
