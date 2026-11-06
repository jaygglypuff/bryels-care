/**
 * ADR-110 C5 (pure): why a machine cannot be used, in plain words for the floor, and what fixes it.
 * "SC-01 needs cleaning after the last batch" / "SC-02 calibration is overdue since 1 Nov".
 */
import type { AvailabilityReason } from "./equipment";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-01" → "1 Nov" (same year as `today`) or "1 Nov 2025". */
export function shortDay(iso: string, today: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]}${today.slice(0, 4) === String(y) ? "" : ` ${y}`}`;
}

export type EquipmentFix = "record_cleaning" | "maintenance" | "manager" | "qa";
export type EquipmentWhy = { code: AvailabilityReason["code"]; text: string; fix: EquipmentFix };

export function equipmentWhy(code: string, reasons: readonly Pick<AvailabilityReason, "code" | "detail" | "dueDate">[], today: string): EquipmentWhy[] {
  return reasons.map((r) => {
    switch (r.code) {
      case "cleaning_required":
        return { code: r.code, text: r.detail === "Cleaning in progress" ? `${code} is being cleaned. Record the cleaning when it is done` : `${code} needs cleaning after the last batch`, fix: "record_cleaning" as const };
      case "calibration_due":
        return { code: r.code, text: `${code} calibration is overdue since ${r.dueDate ? shortDay(r.dueDate, today) : "its due date"}`, fix: "maintenance" as const };
      case "maintenance_due":
        return { code: r.code, text: `${code} maintenance is overdue since ${r.dueDate ? shortDay(r.dueDate, today) : "its due date"}`, fix: "maintenance" as const };
      case "qualification_pending":
        return { code: r.code, text: `${code}: ${r.detail.toLowerCase()}`, fix: "qa" as const };
      default:
        return { code: r.code, text: `${code} is ${r.detail.toLowerCase()}`, fix: "manager" as const };
    }
  });
}

/** The words that say who fixes it ("Maintenance fixes it: ask Dino or Ramon."). */
export function fixerWords(fix: EquipmentFix, names: readonly string[]): string | null {
  const who = names.length ? ` (${names.slice(0, 3).join(", ")}${names.length > 3 ? ` or ${names.length - 3} others` : ""})` : "";
  if (fix === "maintenance") return `Maintenance or the site manager fixes it${who}.`;
  if (fix === "manager") return `Ask the site manager${who}.`;
  if (fix === "qa") return "Ask QA.";
  return null;
}
