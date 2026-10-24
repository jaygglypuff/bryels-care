/**
 * Chart palette (docs/ux-system.md §2.6, light theme). Categorical slots in fixed order, never
 * cycled; status colours only when a series means good or bad. Slots 5 and 6 sit below 3:1 on
 * white, so charts always carry direct value labels and a table twin.
 */
export const CHART_SLOTS = ["#2F8A54", "#2A78D6", "#EB6834", "#6250D6", "#EDA100", "#E87BA4"] as const;

export const VIZ = {
  good: "#2e7d32",
  bad: "#c62828",
  warn: "#b26a00",
  neutral: "#6b7565",
  grid: "var(--border)",
  axis: "var(--border-strong)",
  text: "var(--fg-muted)",
  comparison: "#9aa594",
} as const;

export const SEQUENTIAL = ["#7BBB90", "#57A574", "#2F8A54", "#23703F", "#1B5A33"] as const;

export function slotColor(slot: number): string {
  return CHART_SLOTS[(Math.max(1, slot) - 1) % CHART_SLOTS.length];
}

export function toneColor(tone: "good" | "bad" | "warn" | "neutral" | undefined, fallbackSlot = 1): string {
  if (tone === "good") return VIZ.good;
  if (tone === "bad") return VIZ.bad;
  if (tone === "warn") return VIZ.warn;
  return slotColor(fallbackSlot);
}
