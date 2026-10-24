import { sha256Hex } from "../checksum";
import { templateDefinitionSchema, type TemplateDefinition } from "../schemas";
import { bmrPaperPageRendererV1 } from "./bmr-paper-page-v1";
import { bmrRendererV1 } from "./bmr-v1";
import { labelRendererV1 } from "./label-v1";
import { testPageRendererV1 } from "./test-page-v1";
import { dispensingSheetRendererV1 } from "./dispensing-sheet-v1"; // W2A
import { travelerRendererV1 } from "./traveler-v1"; // W2A
import { boxingNoteRendererV1 } from "./boxing-note-v1"; // W3E
import { pickListRendererV1 } from "./pick-list-v1"; // W3E
import { deliveryReceiptRendererV1 } from "./delivery-receipt-v1"; // W3E
import type { FrozenDataset, RenderOutput, Renderer } from "./types";

/**
 * Code renderers known to this build. A template version may only reference a renderer listed
 * here (US-2-11 AC1); adding a document kind means adding a renderer file and a line below.
 */
const RENDERERS: readonly Renderer[] = [
  labelRendererV1,
  testPageRendererV1,
  bmrRendererV1, // W2D (US-3-17)
  bmrPaperPageRendererV1, // W2D (US-3-20)
  dispensingSheetRendererV1, // W2A (US-3-08)
  travelerRendererV1, // W2A (US-3-08)
  boxingNoteRendererV1, // W3E (US-4-07, US-4-08, US-4-11)
  pickListRendererV1, // W3E (US-4-10)
  deliveryReceiptRendererV1, // W3E (US-4-12, US-4-13)
];

export function findRenderer(id: string, version: number): Renderer | null {
  return RENDERERS.find((r) => r.id === id && r.version === version) ?? null;
}

export function renderersForKind(kind: string): Renderer[] {
  return RENDERERS.filter((r) => r.kinds.includes(kind));
}

/** Template kinds that can be created in this build (a renderer exists for them). */
export function supportedKinds(): string[] {
  return [...new Set(RENDERERS.flatMap((r) => r.kinds))];
}

export type DefinitionCheck = { ok: true; definition: TemplateDefinition; renderer: Renderer } | { ok: false; errors: string[] };

/** Validates a definition against `document_template/v1` and the renderer registry. */
export function checkDefinition(raw: unknown, templateKind: string): DefinitionCheck {
  const parsed = templateDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "definition"}: ${i.message}`) };
  }
  const def = parsed.data;
  const renderer = findRenderer(def.renderer.id, def.renderer.version);
  if (!renderer) return { ok: false, errors: [`renderer: "${def.renderer.id}" v${def.renderer.version} does not exist in this version of the system.`] };
  if (!renderer.kinds.includes(templateKind)) return { ok: false, errors: [`renderer: "${renderer.id}" cannot lay out ${templateKind.replace(/_/g, " ")} documents.`] };
  if (!renderer.datasets.includes(def.dataset)) return { ok: false, errors: [`dataset: "${def.dataset}" is not supported by renderer ${renderer.id} v${renderer.version} (use ${renderer.datasets.join(", ")}).`] };
  if (templateKind === "label" && def.page.size !== "label") return { ok: false, errors: ["page.size: label templates take their size from the label media; use \"label\"."] };
  if (templateKind !== "label" && def.page.size === "label") return { ok: false, errors: ["page.size: only label templates may use \"label\"."] };
  const own = renderer.validateDefinition?.(def) ?? [];
  if (own.length) return { ok: false, errors: own };
  return { ok: true, definition: def, renderer };
}

export type RenderedDocument = RenderOutput & { html: string; checksumSha256: string };

/**
 * Renders a frozen dataset with the pinned definition. Pure and deterministic: the checksum is
 * sha256 over the stylesheet and body, so re-rendering the stored dataset proves the printed
 * page is the recorded one.
 */
export function renderFrozen(definitionRaw: unknown, templateKind: string, input: FrozenDataset): RenderedDocument {
  const check = checkDefinition(definitionRaw, templateKind);
  if (!check.ok) throw new Error(`Template definition is not valid: ${check.errors.join("; ")}`);
  check.renderer.validateData(check.definition.dataset, input.data);
  const out = check.renderer.render(check.definition, input);
  const htmlText = `<style>${out.css}</style>${out.body.value}`;
  return { ...out, html: htmlText, checksumSha256: sha256Hex(htmlText) };
}
