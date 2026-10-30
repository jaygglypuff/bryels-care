import Link from "next/link";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { PRODUCT_TRANSITIONS, getProduct, productFamilies, uomOptions, type ProductStatus } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { ActionForm, Grid, SelectField, TextField } from "../../_org/form";
import { productStatusAction, saveProductAction, saveSkuAction } from "../../_org/actions";
import { ReadOnlyNote, StateChip } from "../../_org/ui";
import { SkuFields } from "./sku-fields";
import { DeleteDraftCard } from "../../../delete-draft-button";

export const metadata = { title: "Product" };

const VERB: Record<ProductStatus, string> = { draft: "Back to draft", active: "Activate", discontinued: "Discontinue" };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.product.view")) return <Forbidden what="products" />;
  const { id } = await params;
  const { created } = await searchParams;
  let p;
  try {
    p = await getProduct(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return <EmptyState title="Product not found" action={<LinkButton href="/masterdata/products" variant="secondary">All products</LinkButton>} />;
    throw e;
  }
  const canEdit = ctx.can("masterdata.product.edit") && p.status !== "discontinued";
  const canSku = ctx.can("masterdata.sku.create") && p.status !== "discontinued";
  const families = await productFamilies(db, ctx.organizationId, { keep: p.family });
  const familyLabel = families.find((f) => f.value === p.family)?.label.replace(/ \(no longer used\)$/, "") ?? p.family;
  const units = await uomOptions(db, ctx.organizationId);
  const moves = ctx.can("masterdata.product.edit") ? PRODUCT_TRANSITIONS[p.status as ProductStatus] ?? [] : [];
  return (
    <div className="space-y-5">
      <PageHeader title={`${p.code} · ${p.name}`} subtitle={<>{familyLabel} · <StateChip status={p.status} /></>} actions={<LinkButton href="/masterdata/products" variant="secondary">All products</LinkButton>} />
      {created === "1" && <Banner tone="ok" title="Product created as draft">Add its SKUs, then activate it.</Banner>}
      <Card>
        <CardTitle>SKUs ({p.skus.length})</CardTitle>
        {!ctx.can("masterdata.sku.view") ? (
          <p className="text-[13px] text-muted">Your role does not include SKUs.</p>
        ) : p.skus.length === 0 ? (
          <p className="text-[13px] text-muted">No SKUs yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {p.skus.map((s) => (
              <li key={s.id}>
                <Link href={`/masterdata/products/${p.id}/skus/${s.id}`} className="block rounded-[12px] border border-line p-3 hover:bg-surface-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold">{s.code}</span>
                    <StateChip status={s.status} />
                  </div>
                  <p className="text-[13px]">{s.name}</p>
                  <p className="text-[12px] text-muted">
                    {s.variantLabel ?? "—"} · stock in {s.uomBaseCode} · {s.unitsPerBox ?? "—"}/box · {s.boxesPerPallet ?? "—"} boxes/pallet · {s.allocationRule.toUpperCase()}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {canSku && (
          <details className="mt-4 border-t border-line pt-4">
            <summary className="cursor-pointer font-medium text-primary-text">Add an SKU</summary>
            <div className="mt-3">
              <ActionForm action={saveSkuAction} submitLabel="Create SKU (draft)" variant="cta" hidden={{ productId: p.id }}>
                <SkuFields units={units} defaults={{ name: p.name, unitsPerBox: p.unitsPerBox, shelfLifeDays: p.shelfLifeDays }} />
              </ActionForm>
            </div>
          </details>
        )}
      </Card>
      <Card>
        <CardTitle>Product details</CardTitle>
        {canEdit ? (
          <ActionForm action={saveProductAction} submitLabel="Save product" hidden={{ _id: p.id }}>
            <Grid>
              <TextField name="code" label="Code" defaultValue={p.code} mono hint="Fixed once formulas, batches or stock reference it." />
              <TextField name="name" label="Name" defaultValue={p.name} />
              <SelectField name="family" label="Family" defaultValue={p.family} options={families} hint="To add a family, go to Master data → Lists." />
              <TextField name="unitNetMassG" label="Net mass per unit (g)" defaultValue={Number(p.unitNetMassG).toString()} inputMode="decimal" />
              <TextField name="unitsPerBox" label="Units per box" defaultValue={p.unitsPerBox} inputMode="numeric" />
              <TextField name="shelfLifeDays" label="Shelf life (days)" defaultValue={p.shelfLifeDays} inputMode="numeric" />
              <TextField name="storageConditions" label="Storage conditions" defaultValue={p.storageConditions} />
            </Grid>
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this product" />
        )}
      </Card>
      {moves.length > 0 && (
        <Card>
          <CardTitle>Status</CardTitle>
          <p className="mb-3 text-[13px] text-muted">Draft → active → discontinued. Discontinuing also discontinues the product's SKUs; it is final.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {moves.map((s) => (
              <ActionForm key={s} action={productStatusAction} submitLabel={VERB[s]} variant={s === "discontinued" ? "danger" : "primary"} hidden={{ _id: p.id, status: s }}>
                <TextField name="reason" label={s === "discontinued" ? "Reason" : "Note (optional)"} />
              </ActionForm>
            ))}
          </div>
        </Card>
      )}
      {p.status === "draft" && (ctx.can("masterdata.product.edit") || ctx.can("masterdata.product.create")) && <DeleteDraftCard kind="product" id={p.id} what="product" note="This product is still a draft. If nothing uses it yet (no formula, batch, order or stock), you can delete it together with its SKUs." />}
    </div>
  );
}
