import { Chip } from "@/ui/status";

const JOB: Record<string, { tone: "ok" | "warn" | "bad" | "info" | "neu"; label: string }> = {
  queued: { tone: "neu", label: "Queued" },
  rendering: { tone: "info", label: "Preparing" },
  ready: { tone: "info", label: "Ready to print" },
  printed: { tone: "ok", label: "Printed" },
  failed: { tone: "bad", label: "Failed" },
  cancelled: { tone: "neu", label: "Cancelled" },
};

/** Label job status with text + tone (never colour alone). Voided printed labels show "Superseded". */
export function JobStatus({ status, voided }: { status: string; voided?: boolean }) {
  if (voided) return <Chip tone="bad">Superseded — destroy</Chip>;
  const s = JOB[status] ?? { tone: "neu" as const, label: status };
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export const STATUS_AT_PRINT: Record<string, string> = { quarantine: "QUARANTINE", released: "RELEASED", on_hold: "ON HOLD", rejected: "REJECTED", expired: "EXPIRED", recalled: "RECALLED" };

export function shortRef(id: string) {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
