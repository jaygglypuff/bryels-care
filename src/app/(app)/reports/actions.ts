"use server";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { createSchedule, reportByCode, setScheduleActive, updateReportDefinition, updateSchedule } from "@/modules/reports";

/** Thin adapters over the reports service (US-5-04, US-5-05). Rules live in src/modules/reports. */
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { ...(s.fieldErrors ?? {}), [e.details.field]: e.message } };
  return s;
}

export async function updateReportDefinitionAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await updateReportDefinition(ctx, str(f, "code"), { enabled: str(f, "enabled") !== "off", ownerNote: str(f, "ownerNote") || null, reason: str(f, "reason") });
    refreshCurrentPage();
    return { ok: true, message: "Report settings saved." };
  } catch (e) {
    return withField(e);
  }
}

/** Schedule form → service input; report filters are the form fields prefixed `p_`. */
function scheduleFromForm(f: FormData) {
  const reportCode = str(f, "reportCode");
  const def = reportByCode(reportCode);
  const parameters: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith("p_") && typeof v === "string" && v.trim() && v !== "all") parameters[k.slice(2)] = v.trim();
  if (def) for (const p of def.params) if (p.kind === "select" && parameters[p.name] === p.default) delete parameters[p.name];
  const wd = str(f, "weekday");
  const md = str(f, "monthDay");
  return {
    name: str(f, "name"),
    reportCode,
    siteId: str(f, "siteId") || null,
    cadence: str(f, "cadence") as "daily",
    runAtTime: str(f, "runAtTime"),
    weekday: wd ? Number(wd) : null,
    monthDay: md ? Number(md) : null,
    format: str(f, "format") as "xlsx",
    parameters,
    recipientUserIds: f.getAll("recipientUserIds").map(String).filter(Boolean),
  };
}

export async function createScheduleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  let id: string;
  try {
    id = (await createSchedule(ctx, scheduleFromForm(f), { idempotencyKey: str(f, "idempotencyKey") || null })).id;
  } catch (e) {
    return withField(e);
  }
  redirect(`/reports/schedules/${id}?ok=created`);
}

export async function updateScheduleAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    await updateSchedule(ctx, str(f, "id"), scheduleFromForm(f), Number(str(f, "version")));
    refreshCurrentPage();
    return { ok: true, message: "Schedule saved. The next delivery uses the new settings." };
  } catch (e) {
    return withField(e);
  }
}

export async function setScheduleActiveAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  try {
    const active = str(f, "active") === "true";
    await setScheduleActive(ctx, str(f, "id"), active, str(f, "reason"));
    refreshCurrentPage();
    return { ok: true, message: active ? "Schedule resumed." : "Schedule paused; nothing is delivered until it is resumed." };
  } catch (e) {
    return withField(e);
  }
}
