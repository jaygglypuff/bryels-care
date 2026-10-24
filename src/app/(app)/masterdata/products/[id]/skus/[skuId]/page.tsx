import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { PRODUCT_TRANSITIONS, getSku, uomOptions, type ProductStatus } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../../forbidden";
import { ActionForm, TextField } from "../../../../_org/form";
import { saveSkuAction, skuStatusAction } from "../../../../_org/actions";
import { ReadOnlyNote, StateChip } from "../../../../_org/ui";
import { SkuFields } from "../../sku-fields";

export const metadata = { title: "SKU" };

const VERB: Record<ProductStatus, string> = { draft: "Back to draft", active: "Activate", discontinued: "Discontinue" };

export default async function SkuPage({ params, searchParams }: { params: Promise<{ id: string; skuId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.sku.view")) return <Forbidden what="SKUs" />;
  const { id, skuId } = await params;
  const { created } = await searchParams;
  let s;
  try {
    s = await getSku(ctx, skuId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="SKU not found" action={<LinkButton href={`/masterdata/products/${id}`} variant="secondary">Back to product</LinkButton>} />;
    throw e;
  }
  const units = await uomOptions(db, ctx.organizationId);
  const canEdit = ctx.can("masterdata.sku.edit") && s.status !== "discontinued";
  const moves = ctx.can("masterdata.sku.edit") ? PRODUCT_TRANSITIONS[s.status as ProductStatus] ?? [] : [];
  return (
    <div className="space-y-5">
      <PageHeader title={`${s.code} · ${s.name}`} subtitle={<StateChip status={s.status} />} actions={<LinkButton href={`/masterdata/products/${s.productId}`} variant="secondary">Back to product</LinkButton>} />
      {created === "1" && <Banner tone="ok" title="SKU created as draft">Activate it once the product is active.</Banner>}
      <Card>
        <CardTitle>SKU details</CardTitle>
        {canEdit ? (
          <ActionForm action={saveSkuAction} submitLabel="Save SKU" hidden={{ _id: s.id, productId: s.productId }}>
            <SkuFields units={units} defaults={s} />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this SKU" />
        )}
      </Card>
      {moves.length > 0 && (
        <Card>
          <CardTitle>Status</CardTitle>
          <p className="mb-3 text-[13px] text-muted">An SKU can be active only while its product is active. Discontinued is final.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {moves.map((st) => (
              <ActionForm key={st} action={skuStatusAction} submitLabel={VERB[st]} variant={st === "discontinued" ? "danger" : "primary"} hidden={{ _id: s.id, status: st }}>
                <TextField name="reason" label={st === "discontinued" ? "Reason" : "Note (optional)"} />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
