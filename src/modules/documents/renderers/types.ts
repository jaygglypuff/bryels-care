import type { SafeHtml } from "../html";
import type { TemplateDefinition } from "../schemas";

/**
 * Identity of a generated document, frozen into `generated_documents.dataset.meta` so that a
 * reprint re-renders exactly the same text (except the reprint marker, which is its own field).
 */
export type DocumentMeta = {
  documentNumber: string;
  documentKind: string;
  templateCode: string;
  templateName: string;
  templateVersionNo: number;
  definitionChecksum: string;
  watermark: string | null;
  recordRevisionNo: number;
  reprintNo: number;
  reprintOfNumber: string | null;
  sourceRevisionAt: string;
  sourceState: string | null;
  generatedAt: string;
  generatedByName: string;
  siteCode: string | null;
  organizationName: string;
  /** Short reference printed on labels for reprint tracing (first 8 hex of the job / document id). */
  traceRef: string;
};

/** Everything a renderer reads. Renderers are pure: same input, same output, no I/O. */
export type FrozenDataset<D = unknown> = { meta: DocumentMeta; data: D };

export type RenderOutput = {
  /** Complete stylesheet (screen preview + print), including the @page rule. */
  css: string;
  /** Body markup; every interpolated value is escaped. */
  body: SafeHtml;
  /** Pages when known (labels: one per copy). */
  pageCount: number | null;
};

export interface Renderer {
  id: string;
  version: number;
  /** Template kinds this renderer can lay out. */
  kinds: readonly string[];
  /** Dataset ids accepted (definition.dataset). */
  datasets: readonly string[];
  title: string;
  /** Default definition offered when a template of `kind` is created. */
  defaultDefinition(kind: string, dataset?: string): TemplateDefinition;
  /** Renderer-specific rules on the definition (e.g. BMR sections C, E, H, J are mandatory); empty = valid. */
  validateDefinition?(definition: TemplateDefinition): string[];
  /** Throws when the dataset does not have the expected shape. */
  validateData(dataset: string, data: unknown): void;
  render(definition: TemplateDefinition, input: FrozenDataset): RenderOutput;
}
