"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import {
  createLabelTemplateAction,
  createTemplateAction,
  labelTemplateStatusAction,
  stationAction,
  testPageAction,
  updateLabelTemplateAction,
  versionAction,
} from "./actions";

export function NewTemplateForm({ kinds }: { kinds: { value: string; label: string; datasets: string[] }[] }) {
  const [state, action] = useActionState<ActionState, FormData>(createTemplateAction, null);
  const [kind, setKind] = useState(kinds[0]?.value ?? "");
  const fe = state?.fieldErrors ?? {};
  const datasets = kinds.find((k) => k.value === kind)?.datasets ?? [];
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="code" error={fe.code} hint="Printed in the footer, e.g. LBL-RM-2.">
          <Input id="code" name="code" required className="font-mono uppercase" autoComplete="off" />
        </Field>
        <Field label="Name" htmlFor="name" error={fe.name}>
          <Input id="name" name="name" required />
        </Field>
        <Field label="Kind" htmlFor="templateKind" error={fe.templateKind} hint="Only kinds with a renderer in this version are listed.">
          <Select id="templateKind" name="templateKind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </Select>
        </Field>
        {kind === "label" ? (
          <Field label="Label data" htmlFor="dataset" hint="Which records this layout prints.">
            <Select id="dataset" name="dataset">
              {datasets.filter((d) => d !== "label/test/v1").map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Page" htmlFor="pageSize">
            <Select id="pageSize" name="pageSize" defaultValue="A4">
              <option value="A4">A4</option>
              <option value="Letter">US Letter</option>
            </Select>
          </Field>
        )}
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Creating…">Create template with draft v1</SubmitButton>
    </form>
  );
}

/** A one-op form for a template version (submit / approve / new draft). */
export function VersionOp({ templateId, versionId, op, label, variant = "secondary", confirm }: { templateId: string; versionId?: string; op: string; label: string; variant?: "cta" | "secondary" | "danger"; confirm?: string }) {
  const [state, action] = useActionState<ActionState, FormData>(versionAction, null);
  return (
    <form action={action} onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }} className="space-y-2">
      <input type="hidden" name="templateId" value={templateId} />
      {versionId && <input type="hidden" name="versionId" value={versionId} />}
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={variant} pendingText="Saving…">{label}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

/** Return-to-draft or retire with a reason. */
export function VersionReasonOp({ templateId, versionId, op, label }: { templateId: string; versionId: string; op: "return" | "retire"; label: string }) {
  const [state, action] = useActionState<ActionState, FormData>(versionAction, null);
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="op" value={op} />
      <div className="min-w-0 flex-1">
        <Field label="Reason" htmlFor={`${op}-${versionId}`} error={state?.fieldErrors?.reason}>
          <Input id={`${op}-${versionId}`} name="reason" required minLength={5} />
        </Field>
      </div>
      <SubmitButton variant={op === "retire" ? "danger" : "secondary"} pendingText="Saving…">{label}</SubmitButton>
      <div className="sm:basis-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function DefinitionEditor({ templateId, versionId, definition }: { templateId: string; versionId: string; definition: string }) {
  const [state, action] = useActionState<ActionState, FormData>(versionAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="op" value="save" />
      <Field label="Definition (document_template/v1 JSON)" htmlFor="definition" error={state?.fieldErrors?.definition} hint="Configuration of a code renderer: sections, labels, options, page settings. HTML is not allowed.">
        <Textarea id="definition" name="definition" defaultValue={definition} spellCheck={false} className="min-h-[320px] font-mono text-[12px]" />
      </Field>
      <Field label="Change note" htmlFor="changeNote">
        <Input id="changeNote" name="changeNote" maxLength={300} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Validating…">Save draft</SubmitButton>
    </form>
  );
}

export function TestPageButton({ versionId }: { versionId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(testPageAction, null);
  const [key] = useState(() => crypto.randomUUID());
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <SubmitButton variant="secondary" pendingText="Generating…">Generate test page</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

type LabelValues = { id?: string; code?: string; name?: string; documentTemplateId?: string; appliesTo?: string; symbology?: string; copiesDefault?: number; mediaWidthMm?: string; mediaHeightMm?: string; dpi?: number; fields?: string[] };

export function LabelTemplateForm({
  layouts,
  appliesTo,
  fieldKeys,
  defaults,
  values,
}: {
  layouts: { id: string; code: string; name: string }[];
  appliesTo: string[];
  fieldKeys: readonly string[];
  defaults: Record<string, string[]>;
  values?: LabelValues;
}) {
  const editing = !!values?.id;
  const [state, action] = useActionState<ActionState, FormData>(editing ? updateLabelTemplateAction : createLabelTemplateAction, null);
  const [applies, setApplies] = useState(values?.appliesTo ?? appliesTo[0]);
  const [fields, setFields] = useState<string[]>(values?.fields ?? defaults[applies] ?? []);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      {values?.id && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="code" error={fe.code}>
          <Input id="code" name="code" required defaultValue={values?.code} readOnly={editing} className="font-mono uppercase" />
        </Field>
        <Field label="Name" htmlFor="name" error={fe.name}>
          <Input id="name" name="name" required defaultValue={values?.name} />
        </Field>
        <Field label="Applies to" htmlFor="appliesTo" error={fe.appliesTo}>
          <Select
            id="appliesTo"
            name="appliesTo"
            value={applies}
            onChange={(e) => {
              setApplies(e.target.value);
              if (!editing) setFields(defaults[e.target.value] ?? []);
            }}
          >
            {appliesTo.map((a) => (
              <option key={a} value={a}>{a.replace("_", " ")}</option>
            ))}
          </Select>
        </Field>
        <Field label="Layout template (kind label)" htmlFor="documentTemplateId" error={fe.documentTemplateId}>
          <Select id="documentTemplateId" name="documentTemplateId" defaultValue={values?.documentTemplateId} required>
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Symbology" htmlFor="symbology" error={fe.symbology} hint="QR for phones (default); Code 128 for linear scanners, labels ≥ 80 mm wide.">
          <Select id="symbology" name="symbology" defaultValue={values?.symbology ?? "qr"}>
            <option value="qr">QR Code</option>
            <option value="code128">Code 128</option>
          </Select>
        </Field>
        <Field label="Default copies" htmlFor="copiesDefault" error={fe.copiesDefault}>
          <Input id="copiesDefault" name="copiesDefault" type="number" min={1} max={99} defaultValue={values?.copiesDefault ?? 1} required />
        </Field>
        <Field label="Width (mm)" htmlFor="mediaWidthMm" error={fe.mediaWidthMm} hint="Assumed media: 50 × 30, 100 × 50, 100 × 150 mm (A-RPT-08).">
          <Input id="mediaWidthMm" name="mediaWidthMm" inputMode="decimal" defaultValue={values?.mediaWidthMm ?? "100"} required />
        </Field>
        <Field label="Height (mm)" htmlFor="mediaHeightMm" error={fe.mediaHeightMm}>
          <Input id="mediaHeightMm" name="mediaHeightMm" inputMode="decimal" defaultValue={values?.mediaHeightMm ?? "50"} required />
        </Field>
        <Field label="Printer resolution" htmlFor="dpi" error={fe.dpi}>
          <Select id="dpi" name="dpi" defaultValue={String(values?.dpi ?? 203)}>
            <option value="203">203 dpi</option>
            <option value="300">300 dpi</option>
            <option value="600">600 dpi</option>
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Printed fields</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {fieldKeys.map((k) => (
            <label key={k} className="flex min-h-[36px] items-center gap-2 text-[13px]">
              <input type="checkbox" name="fields" value={k} checked={fields.includes(k)} onChange={(e) => setFields((f) => (e.target.checked ? [...f, k] : f.filter((x) => x !== k)))} className="h-5 w-5" />
              {k.replace(/_/g, " ")}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-muted">Label wording such as allergen or storage text is QA-validated content (docs/reports-and-templates.md §8.3).</p>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Saving…">{editing ? "Save (returns to draft)" : "Create label template"}</SubmitButton>
    </form>
  );
}

export function LabelStatusOp({ id, op }: { id: string; op: "approve" | "retire" }) {
  const [state, action] = useActionState<ActionState, FormData>(labelTemplateStatusAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      {op === "retire" && (
        <Field label="Reason" htmlFor="retire-reason" error={state?.fieldErrors?.reason}>
          <Input id="retire-reason" name="reason" required minLength={5} />
        </Field>
      )}
      <SubmitButton variant={op === "approve" ? "cta" : "danger"} pendingText="Saving…">{op === "approve" ? "Approve for printing" : "Retire template"}</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function StationForm({ values }: { values?: { id: string; code: string; name: string; printerName: string; notes: string | null; isActive: boolean } }) {
  const [state, action] = useActionState<ActionState, FormData>(stationAction, null);
  const fe = state?.fieldErrors ?? {};
  const p = values?.id ?? "new";
  return (
    <form action={action} className="space-y-3">
      {values && <input type="hidden" name="id" value={values.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" htmlFor={`code-${p}`} error={fe.code}>
          <Input id={`code-${p}`} name="code" required defaultValue={values?.code} readOnly={!!values} className="font-mono uppercase" />
        </Field>
        <Field label="Name" htmlFor={`name-${p}`} error={fe.name}>
          <Input id={`name-${p}`} name="name" required defaultValue={values?.name} placeholder="Warehouse label desk" />
        </Field>
        <Field label="Printer name" htmlFor={`printer-${p}`} error={fe.printerName} hint="As shown in the station's print dialog.">
          <Input id={`printer-${p}`} name="printerName" required defaultValue={values?.printerName} />
        </Field>
        <Field label="Active" htmlFor={`active-${p}`}>
          <Select id={`active-${p}`} name="isActive" defaultValue={values?.isActive === false ? "false" : "true"}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </Field>
      </div>
      <Field label="Notes (media size, location)" htmlFor={`notes-${p}`}>
        <Input id={`notes-${p}`} name="notes" defaultValue={values?.notes ?? ""} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant={values ? "secondary" : "cta"} pendingText="Saving…">{values ? "Save station" : "Add station"}</SubmitButton>
    </form>
  );
}
