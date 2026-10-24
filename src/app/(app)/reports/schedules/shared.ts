import { PERIOD_LABELS, PERIOD_PRESETS, type ReportDefinition } from "@/modules/reports";
import type { ScheduleFormParam } from "./forms";

/** The report's filter fields as plain data for the schedule form (custom dates are not schedulable). */
export function formParams(def: ReportDefinition): ScheduleFormParam[] {
  return def.params.map((p) => {
    if (p.kind === "period") return { name: p.name, kind: "period", label: p.label, default: p.default, options: PERIOD_PRESETS.map((x) => ({ value: x, label: PERIOD_LABELS[x] })) };
    if (p.kind === "select") return { name: p.name, kind: "select", label: p.label, default: p.default, options: p.options };
    if (p.kind === "text") return { name: p.name, kind: "text", label: p.label, maxLength: p.maxLength };
    return { name: p.name, kind: "number", label: p.label, min: p.min, max: p.max, default: p.default };
  });
}
