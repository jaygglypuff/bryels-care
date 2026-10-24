"use client";
import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { Chip } from "@/ui/status";
import { cloneRoleAction, deactivateRoleAction, deleteRoleAction, updateRoleAction } from "./actions";

export type PermOpt = { code: string; module: string; sensitivity: "N" | "S" | "R"; held: boolean };

const SENS_TONE = { N: "neu", S: "warn", R: "bad" } as const;
const SENS_LABEL = { N: "Normal", S: "Sensitive", R: "Restricted" } as const;

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
        Permissions <span className="text-muted">· {sel.size} selected</span>
      </legend>
      <Input aria-label="Filter permissions" placeholder="Filter, e.g. inventory.adjustment" value={q} onChange={(e) => setQ(e.target.value)} />
      {[...sel].filter((c) => !groups.some(([, ps]) => ps.some((p) => p.code === c))).map((c) => (
        <input key={c} type="hidden" name="permissions" value={c} />
      ))}
      <div className="max-h-[480px] overflow-y-auto rounded-[14px] border border-line p-3">
        {groups.map(([mod, ps]) => (
          <section key={mod} className="mb-3">
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-[.04em] text-fg-2">{mod}</h3>
            <ul className="flex flex-col gap-1">
              {ps.map((p) => {
                const checked = sel.has(p.code);
                const locked = !p.held && !checked;
                return (
                  <li key={p.code}>
                    <label className={`flex flex-wrap items-center gap-2 text-[13px] ${locked ? "opacity-50" : ""}`} title={locked ? "You do not hold this permission, so you cannot add it." : undefined}>
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
                      <span className="break-all font-mono text-[12px]">{p.code}</span>
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

export function CloneForm({ sourceRoleId, sourceName, catalogue, selected }: { sourceRoleId: string; sourceName: string; catalogue: PermOpt[]; selected: string[] }) {
  const [state, action] = useActionState<ActionState, FormData>(cloneRoleAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="sourceRoleId" value={sourceRoleId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" error={state?.fieldErrors?.name}>
          <Input id="name" name="name" required minLength={3} maxLength={80} defaultValue={`${sourceName} (custom)`} />
        </Field>
        <Field label="Code" htmlFor="code" error={state?.fieldErrors?.code} hint="Lowercase, e.g. qa_sampler">
          <Input id="code" name="code" required pattern="[a-z][a-z0-9_]{2,40}" maxLength={41} />
        </Field>
      </div>
      <Field label="What this role is for" htmlFor="description">
        <Textarea id="description" name="description" maxLength={500} />
      </Field>
      <PermissionPicker catalogue={catalogue} selected={selected} />
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="cta" pendingText="Creating…">
          Create custom role
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
      <Field label="Name" htmlFor="name" error={state?.fieldErrors?.name}>
        <Input id="name" name="name" required minLength={3} maxLength={80} defaultValue={name} />
      </Field>
      <Field label="What this role is for" htmlFor="description">
        <Textarea id="description" name="description" maxLength={500} defaultValue={description ?? ""} />
      </Field>
      <PermissionPicker catalogue={catalogue} selected={selected} />
      <Field label="Reason for the change" htmlFor="reason" error={state?.fieldErrors?.reason}>
        <Input id="reason" name="reason" required minLength={5} maxLength={300} />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="cta" pendingText="Saving…">
          Save role
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
        <Field label="Reason for deactivating" htmlFor="deact-reason" error={dState?.fieldErrors?.reason} hint="Ends every assignment of this role (audited) and blocks new grants.">
          <Input id="deact-reason" name="reason" required minLength={5} maxLength={300} />
        </Field>
        <FormMessage state={dState} />
        <div>
          <SubmitButton variant="danger" pendingText="Deactivating…">
            Deactivate role
          </SubmitButton>
        </div>
      </form>
      {canDelete && (
        <form action={remove} className="flex flex-col gap-2 border-t border-line pt-3">
          <input type="hidden" name="roleId" value={roleId} />
          <p className="text-[13px] text-muted">This role was never assigned, so it can be deleted.</p>
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
