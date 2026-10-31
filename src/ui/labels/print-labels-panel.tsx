import type { AuthContext } from "@/lib/auth/context";
import { labelPreviewOrNull, type BatchLabelValues, type LabelEntityType, type LabelKind } from "@/modules/documents";
import type { FormAction } from "../form";
import type { PrintLabelsState } from "./actions";
import { LabelPrintCard } from "./label-print-card";

/**
 * Drop-in for any task screen that prints labels (server component, ADR-099):
 *
 *   <PrintLabelsPanel ctx={ctx} entityType="inventory_lot" entityId={lot.id} copies={4} returnTo={here} />
 *   <PrintLabelsPanel ctx={ctx} entityType="batch" entityId={batch.id} copies={pieces} kind="bar"
 *     batchValues={{ lotNumber, manufacturedOn, expiresOn }} action={printBatchLabelsAdapter} />
 *
 * Loads the preview with the caller's permissions and sites, then shows the label, "How many?" and one green
 * "Print N labels". Renders nothing when the user may not see labels or the record is not theirs.
 */
export async function PrintLabelsPanel({
  ctx,
  entityType,
  entityId,
  copies,
  kind,
  returnTo,
  sentence,
  title,
  batchValues,
  action,
  extraFields,
}: {
  ctx: AuthContext;
  entityType: LabelEntityType;
  entityId: string;
  copies?: number;
  kind?: LabelKind;
  returnTo?: string;
  sentence?: string;
  title?: string | null;
  batchValues?: BatchLabelValues | null;
  action?: FormAction<PrintLabelsState>;
  extraFields?: Record<string, string>;
}) {
  if (!ctx.can("inventory.label_job.view")) return null;
  const preview = await labelPreviewOrNull(ctx, { entityType, entityId, copies, batchValues });
  if (!preview) return null;
  return <LabelPrintCard preview={preview} kind={kind} returnTo={returnTo} sentence={sentence} title={title} action={action} extraFields={extraFields} />;
}
