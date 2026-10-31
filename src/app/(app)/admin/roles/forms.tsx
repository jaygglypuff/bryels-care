"use client";
import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { Chip } from "@/ui/status";
import { plainAction, plainModule } from "@/ui/permission-words";

/** "inventory.adjustment.approve" → "Approve: adjustment". */
const permLabel = (code: string) => {
  const [, entity = "", action = ""] = code.split(".");
  const verb = plainAction(action);
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)}: ${entity.replace(/_/g, " ")}`;
};
import { cloneRoleAction, deactivateRoleAction, deleteRoleAction, updateRoleAction } from "./actions";

export type PermOpt = { code: string; module: string; sensitivity: "N" | "S" | "R"; held: boolean };

const SENS_TONE = { N: "neu", S: "warn", R: "bad" } as const;
const SENS_LABEL = { N: "Normal", S: "Careful", R: "Needs the owner's OK" } as const;

/** Grouped permission checklist. Strings the editor does not hold cannot be added (custom roles never exceed the creator). */
function PermissionPicker({ catalogue, selected }: { catalogue: PermOpt[]; selected: string[] }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set(selected));
  const groups = useMemo(() => {
    const m = new Map<string, PermOpt[]>();
    for (const p of catalogue) if (!q || p.code.includes(q.toLowerCase())) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    return [...m.entries()];
  }, [catalogue, q]);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[13px] font-medium text-fg">
        What this job may do <span className="text-muted">· {sel.size} ticked</span>
      </legend>
      <Input aria-label="Filter permissions" placeholder="Filter, e.g. inventory.adjustment" value={q} onChange={(e) => setQ(e.target.value)} />
      {[...sel].filter((c) => !groups.some(([, ps]) => ps.some((p) => p.code === c))).map((c) => (
        <input key={c} type="hidden" name="permissions" value={c} />
      ))}
      <div className="max-h-[480px] overflow-y-auto rounded-[14px] border border-line p-3">
        {groups.map(([mod, ps]) => (
          <section key={mod} className="mb-3">
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[.04em] text-fg-2">{plainModule(mod)}</h3>
            <ul className="flex flex-col gap-1">
              {ps.map((p) => {
                const checked = sel.has(p.code);
                const locked = !p.held && !checked;
                return (
                  <li key={p.code}>
                    <label className={`flex min-h-[40px] flex-wrap items-center gap-2 text-[13px] ${locked ? "opacity-50" : ""}`} title={locked ? "You do not hold this permission, so you cannot add it." : undefined}>
                      <input
                        type="checkbox"
                        name="permissions"
                        value={p.code}
                        checked={checked}
                        disabled={locked}
                        onChange={(e) => {
                          const n = new Set(sel);
                          if (e.target.checked) n.add(p.code);
                          else n.delete(p.code);
                          setSel(n);
                        }}
                        className="size-4"
                      />
                      <span className="min-w-0">
                        <span className="block">{permLabel(p.code)}</span>
                        <span className="block break-all font-mono text-[11px] text-muted">{p.code}</span>
                      </span>
                      {p.sensitivity !== "N" && <Chip tone={SENS_TONE[p.sensitivity]}>{SENS_LABEL[p.sensitivity]}</Chip>}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </fieldset>
  );
}

/** The technical role code is made from the name (ADR-088: nobody types a code); editable under More details. */
export function roleCodeFrom(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 34);
  return `${base.length >= 2 ? base : "role"}_${suffix}`;
}

export function CloneForm({ sourceRoleId, sourceName, catalogue, selected }: { sourceRoleId: string; sourceName: string; catalogue: PermOpt[]; selected: string[] }) {
  const [state, action] = useActionState<ActionState, FormData>(cloneRoleAction, null);
  // Deterministic (same on server and client); if the name is reused the server says so and this field opens.
  const suffix = sourceRoleId.replace(/[^a-z0-9]/g, "").slice(-4);
  const [name, setName] = useState(`${sourceName} (our own)`);
  const [code, setCode] = useState<string | null>(null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="sourceRoleId" value={sourceRoleId} />
      <Field label="Name of the new job" htmlFor="name" error={state?.fieldErrors?.name}>
        <Input id="name" name="name" required minLength={3} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <PermissionPicker catalogue={catalogue} selected={selected} />
      <MoreDetails open={!!state?.fieldErrors?.code}>
        <Field label="What this job is for (optional)" htmlFor="description">
          <Textarea id="description" name="description" maxLength={500} />
        </Field>
        <Field label="Technical name (made for you)" htmlFor="code" error={state?.fieldErrors?.code} hint="Small letters, numbers and _ only. Change it only if the IT person asks.">
          <Input id="code" name="code" required pattern="[a-z][a-z0-9_]{2,40}" maxLength={41} value={code ?? roleCodeFrom(name, suffix)} onChange={(e) => setCode(e.target.value)} />
        </Field>
      </MoreDetails>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="cta" pendingText="Making…">
          Make this job
        </SubmitButton>
      </div>
    </form>
  );
}

export function EditRoleForm({ roleId, name, description, catalogue, selected }: { roleId: string; name: string; description: string | null; catalogue: PermOpt[]; selected: string[] }) {
  const [state, action] = useActionState<ActionState, FormData>(updateRoleAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="roleId" value={roleId} />
      <Field label="Name of the job" htmlFor="name" error={state?.fieldErrors?.name}>
        <Input id="name" name="name" required minLength={3} maxLength={80} defaultValue={name} />
      </Field>
      <PermissionPicker catalogue={catalogue} selected={selected} />
      <Field label="Why you change it" htmlFor="reason" error={state?.fieldErrors?.reason}>
        <Input id="reason" name="reason" required minLength={5} maxLength={300} />
      </Field>
      <MoreDetails>
        <Field label="What this job is for (optional)" htmlFor="description">
          <Textarea id="description" name="description" maxLength={500} defaultValue={description ?? ""} />
        </Field>
      </MoreDetails>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="cta" pendingText="Saving…">
          Save the job
        </SubmitButton>
      </div>
    </form>
  );
}

export function RetireRoleForms({ roleId, canDelete }: { roleId: string; canDelete: boolean }) {
  const [dState, deactivate] = useActionState<ActionState, FormData>(deactivateRoleAction, null);
  const [xState, remove] = useActionState<ActionState, FormData>(deleteRoleAction, null);
  return (
    <div className="flex flex-col gap-4">
      <form action={deactivate} className="flex flex-col gap-3">
        <input type="hidden" name="roleId" value={roleId} />
        <Field label="Why you stop using it" htmlFor="deact-reason" error={dState?.fieldErrors?.reason} hint="Takes this job away from everyone who has it and it can no longer be given. Kept in the history of changes.">
          <Input id="deact-reason" name="reason" required minLength={5} maxLength={300} />
        </Field>
        <FormMessage state={dState} />
        <div>
          <SubmitButton variant="danger" pendingText="Deactivating…">
            Stop using this job
          </SubmitButton>
        </div>
      </form>
      {canDelete && (
        <form action={remove} className="flex flex-col gap-2 border-t border-line pt-3">
          <input type="hidden" name="roleId" value={roleId} />
          <p className="text-[13px] text-muted">Nobody ever had this job, so it can be deleted.</p>
          <FormMessage state={xState} />
          <div>
            <SubmitButton variant="secondary" pendingText="Deleting…">
              Delete role
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
