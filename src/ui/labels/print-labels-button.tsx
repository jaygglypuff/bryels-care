"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Printer } from "lucide-react";
import type { LabelEntityType, LabelKind, LabelPreview } from "@/modules/documents";
import { fmtDateTime } from "@/lib/qty";
import { Button, Field, Input, LinkButton, Select, Textarea } from "../core";
import { FormMessage, SubmitButton, useInPlaceAction, type FormAction } from "../form";
import { printLabelsAction, reprintLabelsAction, type PrintLabelsState } from "./actions";
import { labelCountWords, LABEL_KIND_WORDS } from "./words";

/** Where the print page goes back to, and the print page of a job. */
export function printPageHref(jobId: string, returnTo?: string | null, auto = true) {
  const q = new URLSearchParams();
  if (auto) q.set("auto", "1");
  if (returnTo) q.set("back", returnTo);
  const s = q.toString();
  return `/print/labels/${jobId}${s ? `?${s}` : ""}`;
}

function HowMany({ value, onChange, max, unit, id }: { value: number; onChange: (n: number) => void; max: number; unit: string; id: string }) {
  const set = (n: number) => onChange(Math.min(max, Math.max(1, Number.isFinite(n) ? Math.floor(n) : 1)));
  return (
    <Field label={`How many? (one for each ${unit})`} htmlFor={id}>
      <div className="flex items-stretch gap-2">
        <Button type="button" variant="secondary" size="lg" aria-label="One less" onClick={() => set(value - 1)} className="min-w-[52px] px-0">
          <Minus size={20} aria-hidden />
        </Button>
        <Input id={id} name="copies" type="number" inputMode="numeric" min={1} max={max} value={value} onChange={(e) => set(Number(e.target.value))} className="min-h-[52px] w-[96px] text-center text-[20px] font-semibold" required />
        <Button type="button" variant="secondary" size="lg" aria-label="One more" onClick={() => set(value + 1)} className="min-w-[52px] px-0">
          <Plus size={20} aria-hidden />
        </Button>
      </div>
    </Field>
  );
}

/**
 * "How many? [N]" and one green "Print N labels" (ADR-099). Makes the label job (recorded, audited) and opens
 * the print page, which shows the same label and opens the browser's print window. When the same label was
 * printed before, it asks why and prints it again as a recorded reprint instead. Never fakes success: the
 * server decides, and its message is shown here.
 *
 *   <PrintLabelsButton entityType="inventory_lot" entityId={lot.id} labelTemplateId={opt.templateId}
 *     kind="sack" suggested={4} max={99} returnTo={`/inventory/receive/${gr.id}`} />
 *
 * `action` replaces the default server action (same form fields: entityType, entityId, labelTemplateId,
 * copies, idempotencyKey; must return { ok, jobId } or { ok: false, message }), e.g. production's
 * "print this batch's labels" which first fixes the batch's lot number and dates.
 */
export function PrintLabelsButton({
  entityType,
  entityId,
  labelTemplateId,
  kind,
  suggested,
  max,
  existing,
  blocked,
  canReprint = false,
  reprintReasons = [],
  returnTo,
  action,
  extraFields,
}: {
  entityType: LabelEntityType;
  entityId: string;
  labelTemplateId: string;
  kind: LabelKind;
  suggested: number;
  max: number;
  existing?: LabelPreview["existing"][number] | null;
  blocked?: string | null;
  canReprint?: boolean;
  reprintReasons?: LabelPreview["reprintReasons"];
  returnTo?: string;
  action?: FormAction<PrintLabelsState>;
  extraFields?: Record<string, string>;
}) {
  const router = useRouter();
  const words = LABEL_KIND_WORDS[kind];
  const [copies, setCopies] = useState(Math.min(max, Math.max(1, suggested)));
  const [state, run] = useInPlaceAction<PrintLabelsState>(action ?? printLabelsAction);
  const [rstate, rerun] = useInPlaceAction<PrintLabelsState>(reprintLabelsAction);
  const [reason, setReason] = useState("");
  const done = state?.ok ? state.jobId : rstate?.ok ? rstate.jobId : undefined;
  useEffect(() => {
    if (done) router.push(printPageHref(done, returnTo));
  }, [done, returnTo, router]);

  if (blocked) {
    return (
      <p className="rounded-[14px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] px-4 py-3 text-[15px] text-[var(--warn-fg)]" role="status" data-testid="print-labels-blocked">
        {blocked}
      </p>
    );
  }

  // Made but not printed yet: open it (the count is already set on that label job).
  if (existing?.status === "ready") {
    return (
      <div className="grid gap-2" data-testid="print-labels">
        <p className="text-[15px] text-fg-2">These labels are ready but not printed yet ({labelCountWords(existing.copies)}).</p>
        <LinkButton href={printPageHref(existing.jobId, returnTo)} variant="cta" size="lg" className="w-full sm:w-auto">
          <Printer size={20} aria-hidden /> Print {labelCountWords(existing.copies)}
        </LinkButton>
      </div>
    );
  }

  // Printed before with the same content: a second set is a reprint with a reason (kept on record).
  if (existing?.status === "printed") {
    const needsNote = reprintReasons.find((r) => r.code === reason)?.requiresNote ?? false;
    const n = Math.min(copies, 99);
    return (
      <form action={rerun} className="grid gap-3" data-testid="print-labels-again">
        <p className="text-[15px] text-fg-2">
          Already printed{existing.printedAt ? ` ${fmtDateTime(existing.printedAt)}` : ""}
          {existing.printedByName ? ` by ${existing.printedByName}` : ""}. Lost or damaged? Print them again and say why.
        </p>
        {canReprint ? (
          <>
            <input type="hidden" name="jobId" value={existing.jobId} />
            <Field label="Why print again?" htmlFor={`why-${entityId}`} error={rstate?.fieldErrors?.reasonCode}>
              <Select id={`why-${entityId}`} name="reasonCode" required value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose…</option>
                {reprintReasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            {needsNote && (
              <Field label="Say what happened" htmlFor={`note-${entityId}`} error={rstate?.fieldErrors?.note}>
                <Textarea id={`note-${entityId}`} name="note" required minLength={5} maxLength={500} />
              </Field>
            )}
            <HowMany id={`copies-${entityId}`} value={n} onChange={setCopies} max={99} unit={words.one} />
            <SubmitButton variant="cta" size="lg" pendingText="Making the labels…" className="w-full sm:w-auto">
              <Printer size={20} aria-hidden /> Print {labelCountWords(n)} again
            </SubmitButton>
            <FormMessage state={rstate} />
          </>
        ) : (
          <p className="text-[15px] text-[var(--warn-fg)]">Your job cannot print labels again. Ask the warehouse lead.</p>
        )}
      </form>
    );
  }

  return (
    <form action={run} className="grid gap-3" data-testid="print-labels">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />
      <input type="hidden" name="labelTemplateId" value={labelTemplateId} />
      {Object.entries(extraFields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <HowMany id={`copies-${entityId}`} value={copies} onChange={setCopies} max={max} unit={words.one} />
      <SubmitButton variant="cta" size="lg" pendingText="Making the labels…" className="w-full sm:w-auto" data-testid="print-labels-submit">
        <Printer size={20} aria-hidden /> Print {labelCountWords(copies)}
      </SubmitButton>
      {state?.existingJobId && !state.ok ? (
        <p className="text-[15px]">
          {state.message}{" "}
          <a className="font-semibold text-primary-text underline" href={printPageHref(state.existingJobId, returnTo, false)}>
            Open that label
          </a>
        </p>
      ) : (
        <FormMessage state={state} />
      )}
    </form>
  );
}
