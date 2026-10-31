"use client";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Field, Input, Select, Textarea } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { NameAndCode } from "@/ui/name-and-code";

import { APPLIES_TEXT } from "./words";
const DATASET_TEXT: Record<string, string> = { "label/material/v1": "Materials", "label/wip/v1": "Half-made product", "label/finished_good/v1": "Finished products", "label/location/v1": "Shelves and places", "label/carton/v1": "Boxes (cartons)" };
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
        <Field label="What it is for" htmlFor="templateKind" error={fe.templateKind} hint="Only the kinds this version can print are listed.">
          <Select id="templateKind" name="templateKind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </Select>
        </Field>
        {kind === "label" ? (
          <Field label="Labels for" htmlFor="dataset" hint="Which records this layout prints.">
            <Select id="dataset" name="dataset">
              {datasets.filter((d) => d !== "label/test/v1").map((d) => (
                <option key={d} value={d}>{DATASET_TEXT[d] ?? d}</option>
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
        <NameAndCode nameLabel="Name" placeholder="e.g. Raw material label" nameError={fe.name} codeError={fe.code} prefix="TPL-" max={30} />
      </div>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Making…">Make the layout (as a draft)</SubmitButton>
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
        <NameAndCode nameLabel="Name" defaultName={values?.name} defaultCode={values?.code} codeReadOnly={editing} placeholder="e.g. Finished product label" nameError={fe.name} codeError={fe.code} prefix="LBL-" max={30} />
        <Field label="Labels for" htmlFor="appliesTo" error={fe.appliesTo}>
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
              <option key={a} value={a}>{APPLIES_TEXT[a] ?? a.replace(/_/g, " ")}</option>
            ))}
          </Select>
        </Field>
        <Field label="Label size" htmlFor="mediaWidthMm" error={fe.mediaWidthMm ?? fe.mediaHeightMm} hint="Width × height in mm (the paper in the label printer).">
          <div className="flex items-center gap-2">
            <Input id="mediaWidthMm" name="mediaWidthMm" inputMode="decimal" defaultValue={values?.mediaWidthMm ?? "100"} required aria-label="Width (mm)" className="w-24" />
            <span aria-hidden>×</span>
            <Input id="mediaHeightMm" name="mediaHeightMm" inputMode="decimal" defaultValue={values?.mediaHeightMm ?? "50"} required aria-label="Height (mm)" className="w-24" />
            <span className="text-[13px] text-muted">mm</span>
          </div>
        </Field>
      </div>
      <MoreDetails open={!!(fe.documentTemplateId || fe.symbology || fe.copiesDefault || fe.dpi)}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Layout" htmlFor="documentTemplateId" error={fe.documentTemplateId}>
          <Select id="documentTemplateId" name="documentTemplateId" defaultValue={values?.documentTemplateId} required>
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Barcode type" htmlFor="symbology" error={fe.symbology} hint="QR for phones (most labels); Code 128 for older scanners, labels ≥ 80 mm wide.">
          <Select id="symbology" name="symbology" defaultValue={values?.symbology ?? "qr"}>
            <option value="qr">QR Code</option>
            <option value="code128">Code 128</option>
          </Select>
        </Field>
        <Field label="Copies each time" htmlFor="copiesDefault" error={fe.copiesDefault}>
          <Input id="copiesDefault" name="copiesDefault" type="number" min={1} max={99} defaultValue={values?.copiesDefault ?? 1} required />
        </Field>
        <Field label="Printer sharpness (dpi)" htmlFor="dpi" error={fe.dpi}>
          <Select id="dpi" name="dpi" defaultValue={String(values?.dpi ?? 203)}>
            <option value="203">203 dpi</option>
            <option value="300">300 dpi</option>
            <option value="600">600 dpi</option>
          </Select>
        </Field>
      </div>
      </MoreDetails>
      <fieldset>
        <legend className="mb-2 text-[14px] font-medium">What is printed on the label</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {fieldKeys.map((k) => (
            <label key={k} className="flex min-h-[44px] items-center gap-2 text-[14px]">
              <input type="checkbox" name="fields" value={k} checked={fields.includes(k)} onChange={(e) => setFields((f) => (e.target.checked ? [...f, k] : f.filter((x) => x !== k)))} className="h-5 w-5" />
              {k.replace(/_/g, " ")}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[13px] text-muted">Words such as allergen or storage text must be checked by QA.</p>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton variant="cta" pendingText="Saving…">{editing ? "Save (QA must OK it again)" : "Make the label"}</SubmitButton>
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
      <SubmitButton variant={op === "approve" ? "cta" : "danger"} pendingText="Saving…">{op === "approve" ? "OK for printing" : "Stop using this label"}</SubmitButton>
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
        <NameAndCode idPrefix={`${p}-`} nameLabel="Name of the place" defaultName={values?.name} defaultCode={values?.code} codeReadOnly={!!values} placeholder="Warehouse label desk" nameError={fe.name} codeError={fe.code} max={20} />
        <Field label="Printer name" htmlFor={`printer-${p}`} error={fe.printerName} hint="As shown when you press Print on that computer.">
          <Input id={`printer-${p}`} name="printerName" required defaultValue={values?.printerName} />
        </Field>
      </div>
      <MoreDetails>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="In use" htmlFor={`active-${p}`}>
            <Select id={`active-${p}`} name="isActive" defaultValue={values?.isActive === false ? "false" : "true"}>
              <option value="true">Yes</option>
              <option value="false">No (not used now)</option>
            </Select>
          </Field>
          <Field label="Notes (label size, where it is)" htmlFor={`notes-${p}`}>
            <Input id={`notes-${p}`} name="notes" defaultValue={values?.notes ?? ""} />
          </Field>
        </div>
      </MoreDetails>
      <FormMessage state={state} />
      <SubmitButton variant={values ? "secondary" : "cta"} pendingText="Saving…">{values ? "Save" : "Add this printer place"}</SubmitButton>
    </form>
  );
}
