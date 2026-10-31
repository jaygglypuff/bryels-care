import "server-only";
import { db } from "@/db/client";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { labelEntityFor, type BatchLabelValues, type LabelEntity } from "./datasets";
import { reprintReasonOptions } from "./generated";
import { labelFace, type LabelFaceData } from "./label-face";
import { labelHistory } from "./label-jobs";
import { fieldKeys, labelTemplatesForKind, loadPrintableTemplate } from "./label-templates";
import type { LabelData } from "./renderers/label-v1";
import { renderFrozen } from "./renderers/registry";
import type { DocumentMeta } from "./renderers/types";
import { activeStationsAt } from "./stations";

/**
 * Label preview for the task screens (ADR-099): what the label will look like, rendered by the same label
 * renderer and the same approved layout as the label job that "Print" makes, so the preview is the print.
 * Read only: nothing is recorded until "Print N labels" creates the label job.
 *
 * The only difference from the printed label is the 5 pt trace reference in the bottom-right corner,
 * which is the job's own reference and exists only once the job is made (the preview shows "NEW").
 */

export type LabelEntityType = "inventory_lot" | "location" | "container" | "batch";

/** What the label is stuck on, for the one-sentence hint ("Stick one on each sack"). */
export type LabelKind = "sack" | "tub" | "bar" | "product_box" | "box" | "shelf";

export type LabelOption = { templateId: string; name: string; media: string; widthMm: number; heightMm: number; face: LabelFaceData };

export type LabelPreview = {
  entity: { type: LabelEntityType; id: string; number: string; name: string | null; appliesTo: string; siteId: string; state: string | null };
  kind: LabelKind;
  /** One per approved label size; the first is the default. */
  options: LabelOption[];
  copies: { suggested: number; max: number };
  /** A label with the same content already exists for the default size: print it (ready) or reprint it with a reason (printed). */
  existing: { jobId: string; templateId: string; status: "ready" | "printed"; copies: number; printedAt: Date | null; printedByName: string | null }[];
  /** Why this user cannot print here (null = can print). The preview is still shown. */
  blocked: string | null;
  /** The site's label printer the job is recorded against (the person still picks it in the print window). */
  printer: { name: string; printerName: string } | null;
  canReprint: boolean;
  reprintReasons: { code: string; label: string; requiresNote: boolean }[];
};

const KIND_OF: Record<string, LabelKind> = { material: "sack", wip: "tub", finished_good: "product_box", product: "bar", carton: "box", pallet: "box", location: "shelf" };

export function labelKindFor(e: Pick<LabelEntity, "entityType" | "appliesTo">): LabelKind {
  if (e.entityType === "batch") return "bar";
  return KIND_OF[e.appliesTo] ?? "box";
}

function previewMeta(code: string, name: string, versionNo: number, definitionChecksum: string, e: LabelEntity, siteCode: string | null): DocumentMeta {
  const now = new Date().toISOString();
  return {
    documentNumber: "PREVIEW",
    documentKind: "label",
    templateCode: code,
    templateName: name,
    templateVersionNo: versionNo,
    definitionChecksum,
    watermark: null,
    recordRevisionNo: 0,
    reprintNo: 0,
    reprintOfNumber: null,
    sourceRevisionAt: e.revisionAt.toISOString(),
    sourceState: e.state,
    generatedAt: now,
    generatedByName: "",
    siteCode,
    organizationName: "",
    traceRef: "NEW",
  };
}

export async function labelPreview(
  ctx: AuthContext,
  input: { entityType: LabelEntityType; entityId: string; copies?: number | null; labelTemplateId?: string | null; batchValues?: BatchLabelValues | null },
): Promise<LabelPreview> {
  ctx.require("inventory.label_job.view");
  const e = await labelEntityFor(ctx, input.entityType, input.entityId, input.batchValues);
  const siteCode = ctx.allowedSites.find((s) => s.id === e.siteId)?.code ?? null;
  const [templates, stations, history, reasons] = await Promise.all([
    labelTemplatesForKind(db, ctx.organizationId, e.siteId, e.appliesTo),
    activeStationsAt(db, ctx.organizationId, e.siteId),
    labelHistory(ctx, e.entityType, e.entityId),
    reprintReasonOptions(ctx),
  ]);
  const ordered = input.labelTemplateId ? [...templates.filter((t) => t.id === input.labelTemplateId), ...templates.filter((t) => t.id !== input.labelTemplateId)] : templates;
  const max = e.entityType === "batch" ? 999 : 99;
  const suggested = Math.min(max, Math.max(1, Math.floor(input.copies ?? ordered[0]?.copiesDefault ?? 1)));

  const options: LabelOption[] = [];
  for (const t of ordered) {
    const { version, layout } = await loadPrintableTemplate(db, ctx, t.id, e.appliesTo, e.siteId).catch(() => ({ version: null, layout: null }));
    if (!version || !layout) continue;
    const data: LabelData = {
      label: { code: t.code, appliesTo: t.appliesTo, symbology: t.symbology as LabelData["label"]["symbology"], mediaWidthMm: Number(t.mediaWidthMm), mediaHeightMm: Number(t.mediaHeightMm), dpi: t.dpi, fields: fieldKeys(t.fields) },
      copies: 1,
      entity: e.entity,
    };
    const out = renderFrozen(version.definition, "label", { meta: previewMeta(layout.code, layout.name, version.versionNo, version.definitionChecksum, e, siteCode), data });
    options.push({ templateId: t.id, name: t.name, media: `${Number(t.mediaWidthMm)} × ${Number(t.mediaHeightMm)} mm`, widthMm: Number(t.mediaWidthMm), heightMm: Number(t.mediaHeightMm), face: labelFace(data, out.body.value, out.css) });
  }

  const existing = history
    .filter((j) => !j.voidedAt && (j.status === "ready" || j.status === "printed") && j.reprintNo === 0 && j.statusAtPrint === e.state)
    .map((j) => ({ jobId: j.id, templateId: j.labelTemplateId, status: j.status as "ready" | "printed", copies: j.copies, printedAt: j.printedAt, printedByName: j.printedByName }));

  const place = siteCode ?? "this site";
  const blocked = !ctx.can("inventory.label_job.create")
    ? "Your job cannot print labels. Ask the warehouse lead."
    : e.siteId !== ctx.currentSiteId
      ? `This is at ${place}. Switch site in the top bar to print its label.`
      : stations.length === 0
        ? `Label printing is not set up for ${place} yet. Ask the administrator (Settings › Labels and printouts).`
        : options.length === 0
          ? "No label is approved for this yet. Ask QA (Settings › Labels and printouts)."
          : null;

  return {
    entity: { type: e.entityType, id: e.entityId, number: e.number, name: e.entity.itemName ?? e.entity.locationName ?? null, appliesTo: e.appliesTo, siteId: e.siteId, state: e.state },
    kind: labelKindFor(e),
    options,
    copies: { suggested, max },
    existing,
    blocked,
    printer: stations[0] ? { name: stations[0].name, printerName: stations[0].printerName } : null,
    canReprint: ctx.can("inventory.label_job.create") && ctx.can("documents.reprint.create"),
    reprintReasons: reasons.map((r) => ({ code: r.code, label: r.label, requiresNote: r.requiresNote })),
  };
}

/** The same, never throwing for "not found / not allowed": task screens show their own state. */
export async function labelPreviewOrNull(ctx: AuthContext, input: Parameters<typeof labelPreview>[1]): Promise<LabelPreview | null> {
  try {
    return await labelPreview(ctx, input);
  } catch (e) {
    if (e instanceof DomainError && ["not_found", "forbidden", "state"].includes(e.code)) return null;
    throw e;
  }
}
