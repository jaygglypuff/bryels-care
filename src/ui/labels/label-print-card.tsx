"use client";
import { useState } from "react";
import type { LabelKind, LabelPreview as Preview } from "@/modules/documents";
import { Select } from "../core";
import type { FormAction } from "../form";
import type { PrintLabelsState } from "./actions";
import { LabelPreview } from "./label-preview";
import { PrintLabelsButton } from "./print-labels-button";
import { LABEL_KIND_WORDS, plainPrinter } from "./words";

/**
 * Preview + "How many?" + "Print N labels" in one card (ADR-099). When QA approved more than one label size
 * for this kind, a small "Label size" choice switches the preview and what prints together, so they never
 * disagree. Rendered by `PrintLabelsPanel` (server) or directly with a `labelPreview()` result.
 */
export function LabelPrintCard({
  preview,
  kind,
  returnTo,
  sentence,
  title,
  action,
  extraFields,
}: {
  preview: Preview;
  kind?: LabelKind;
  returnTo?: string;
  sentence?: string;
  title?: string | null;
  action?: FormAction<PrintLabelsState>;
  extraFields?: Record<string, string>;
}) {
  const k = kind ?? preview.kind;
  const [templateId, setTemplateId] = useState(preview.options[0]?.templateId ?? "");
  const opt = preview.options.find((o) => o.templateId === templateId) ?? preview.options[0];
  const existing = preview.existing.find((x) => x.templateId === opt?.templateId) ?? null;
  return (
    <section className="grid gap-4 rounded-[20px] border border-line bg-surface p-4 sm:p-5" aria-label={title ?? LABEL_KIND_WORDS[k].title} data-testid="label-print-card">
      {title !== null && <h2 className="text-[18px] font-semibold text-fg">{title ?? LABEL_KIND_WORDS[k].title}</h2>}
      {opt ? <LabelPreview kind={k} data={opt.face} sentence={sentence} /> : <p className="text-[15px] text-fg-2">No label is approved for this yet, so there is nothing to show.</p>}
      {opt && preview.printer && !preview.blocked && (
        <p className="text-[15px] text-fg-2" data-testid="label-printer">
          Printer: <strong className="text-fg">{plainPrinter(preview.printer.printerName)}</strong> · label {opt.media}. In the print window choose this printer and <strong>Actual size</strong>.
        </p>
      )}
      {preview.options.length > 1 && (
        <label className="grid gap-1 text-[14px] font-medium text-fg-2">
          Label size
          <Select value={opt?.templateId} onChange={(e) => setTemplateId(e.target.value)} aria-label="Label size">
            {preview.options.map((o) => (
              <option key={o.templateId} value={o.templateId}>
                {o.media} · {o.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      {opt || preview.blocked ? (
        <PrintLabelsButton
          key={opt?.templateId}
          entityType={preview.entity.type}
          entityId={preview.entity.id}
          labelTemplateId={opt?.templateId ?? ""}
          kind={k}
          suggested={preview.copies.suggested}
          max={preview.copies.max}
          existing={existing}
          blocked={preview.blocked}
          canReprint={preview.canReprint}
          reprintReasons={preview.reprintReasons}
          returnTo={returnTo}
          action={action}
          extraFields={extraFields}
        />
      ) : null}
    </section>
  );
}
