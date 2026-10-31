"use client";
import { Field, Input, Select } from "@/ui/core";
import { ActionForm } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { createScheduleAction, setScheduleActiveAction, updateScheduleAction } from "../actions";

export type ScheduleFormParam =
  | { name: string; kind: "period"; label: string; default: string; options: { value: string; label: string }[] }
  | { name: string; kind: "select"; label: string; default: string; options: { value: string; label: string }[] }
  | { name: string; kind: "text"; label: string; maxLength: number }
  | { name: string; kind: "number"; label: string; min: number; max: number; default: number };

export type ScheduleFormValue = {
  id?: string;
  version?: number;
  name: string;
  reportCode: string;
  siteId: string | null;
  cadence: string;
  runAtTime: string;
  weekday: number | null;
  monthDay: number | null;
  format: string;
  parameters: Record<string, string>;
  recipientUserIds: string[];
};

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Create or change a schedule (owner or administrator). The server re-checks every recipient's access. */
export function ScheduleForm({
  value,
  params,
  sites,
  people,
}: {
  value: ScheduleFormValue;
  params: ScheduleFormParam[];
  sites: { id: string; code: string; name: string }[];
  people: { id: string; name: string; email: string }[];
}) {
  const editing = !!value.id;
  return (
    <ActionForm
      action={editing ? updateScheduleAction : createScheduleAction}
      hidden={{ id: value.id, version: value.version !== undefined ? String(value.version) : undefined, reportCode: value.reportCode }}
      submit={editing ? "Save" : "Start sending"}
    >
      {(fe) => {
        const filterOpen = !!(fe.name || fe.siteId || fe.format || fe.monthDay || fe.parameters || params.some((p) => fe[p.name]));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="How often" htmlFor="cadence" error={fe.cadence}>
                <Select id="cadence" name="cadence" defaultValue={value.cadence}>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                  <option value="monthly">Every month</option>
                </Select>
              </Field>
              <Field label="Which day (if every week)" htmlFor="weekday" error={fe.weekday}>
                <Select id="weekday" name="weekday" defaultValue={value.weekday ? String(value.weekday) : "1"}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={String(i + 1)}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Field label="What time" htmlFor="runAtTime" error={fe.runAtTime}>
                <Input id="runAtTime" name="runAtTime" type="time" defaultValue={value.runAtTime} required />
              </Field>
            </div>
            <fieldset className="rounded-[14px] border border-line p-3">
              <legend className="px-1 text-[14px] font-medium">Who gets it</legend>
              {fe.recipientUserIds && <p className="mb-2 text-[13px] text-[var(--bad-fg)]">{fe.recipientUserIds}</p>}
              <div className="grid gap-1 sm:grid-cols-2">
                {people.map((u) => (
                  <label key={u.id} className="flex min-h-[44px] min-w-0 items-center gap-3 text-[14px]">
                    <input type="checkbox" name="recipientUserIds" value={u.id} defaultChecked={value.recipientUserIds.includes(u.id)} className="size-5 shrink-0" />
                    <span className="min-w-0 break-words">{u.name} <span className="block text-[12px] text-muted">{u.email}</span></span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[13px] text-muted">Only people allowed to see this list get it. The system checks again every time it sends.</p>
            </fieldset>
            <MoreDetails open={filterOpen}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name of this email" htmlFor="name" error={fe.name}>
                  <Input id="name" name="name" defaultValue={value.name} required minLength={3} maxLength={120} />
                </Field>
                <Field label="Sites" htmlFor="siteId" error={fe.siteId} hint="All = each person gets their own sites">
                  <Select id="siteId" name="siteId" defaultValue={value.siteId ?? ""}>
                    <option value="">All sites of each person</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="File type" htmlFor="format" error={fe.format}>
                  <Select id="format" name="format" defaultValue={value.format}>
                    <option value="xlsx">Excel</option>
                    <option value="csv">CSV</option>
                    <option value="html">Page to print (or save as PDF)</option>
                  </Select>
                </Field>
                <Field label="Which day (if every month, 1–28)" htmlFor="monthDay" error={fe.monthDay}>
                  <Input id="monthDay" name="monthDay" type="number" min={1} max={28} defaultValue={value.monthDay ?? 1} />
                </Field>
                {params.map((p) =>
                  p.kind === "period" || p.kind === "select" ? (
                    <Field key={p.name} label={p.kind === "period" ? "Dates in the list" : p.label} htmlFor={`p_${p.name}`} error={fe.parameters ?? fe[p.name]}>
                      <Select id={`p_${p.name}`} name={`p_${p.name}`} defaultValue={value.parameters[p.name] ?? p.default}>
                        {p.options.filter((o) => o.value !== "custom").map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </Select>
                    </Field>
                  ) : p.kind === "text" ? (
                    <Field key={p.name} label={p.label} htmlFor={`p_${p.name}`} error={fe[p.name]}>
                      <Input id={`p_${p.name}`} name={`p_${p.name}`} defaultValue={value.parameters[p.name] ?? ""} maxLength={p.maxLength} />
                    </Field>
                  ) : (
                    <Field key={p.name} label={p.label} htmlFor={`p_${p.name}`} error={fe[p.name]}>
                      <Input id={`p_${p.name}`} name={`p_${p.name}`} type="number" min={p.min} max={p.max} defaultValue={value.parameters[p.name] ?? String(p.default)} />
                    </Field>
                  ),
                )}
              </div>
            </MoreDetails>
          </>
        );
      }}
    </ActionForm>
  );
}

export function PauseForm({ id, active }: { id: string; active: boolean }) {
  return (
    <ActionForm action={setScheduleActiveAction} hidden={{ id, active: String(!active) }} submit={active ? "Stop sending for now" : "Start sending again"} variant="secondary" size="sm" className="flex flex-wrap items-end gap-2">
      {(fe) => (
        <Field label="Reason" htmlFor={`reason-${id}`} error={fe.reason}>
          <Input id={`reason-${id}`} name="reason" required minLength={3} maxLength={500} placeholder="Why" className="w-full sm:w-56" />
        </Field>
      )}
    </ActionForm>
  );
}
