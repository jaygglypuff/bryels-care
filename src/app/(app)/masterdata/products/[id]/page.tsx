import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtQty } from "@/lib/qty";
import { PRODUCT_TRANSITIONS, daysToWholeMonths, getProduct, listFormulas, productFamilies, uomOptions, type ProductStatus } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow, RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import { DeleteDraftButton } from "../../../delete-draft-button";
import { ActionForm, TextField } from "../../_org/form";
import { productStatusAction, saveProductAction, saveSkuAction } from "../../_org/actions";
import { ReadOnlyNote } from "../../_org/ui";
import { PlainItemChip, SELLABLE_ITEM_TEXT, WhatIs, NEXT_WRAP } from "../../_eng/plain";
import { ProductFields } from "../product-fields";
import { shelfText } from "../words";
import { SkuFields } from "./sku-fields";

export const metadata = { title: "Product" };

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.product.view")) return <Forbidden what="products" />;
  const { id } = await params;
  const { created } = await searchParams;
  let p;
  try {
    p = await getProduct(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found")
      return (
        <EmptyState title="Product not found" action={<LinkButton href="/masterdata/products" variant="secondary">All products</LinkButton>}>
          It may have been deleted. Go back to the list and search by name.
        </EmptyState>
      );
    throw e;
  }
  const canEdit = ctx.can("masterdata.product.edit") && p.status !== "discontinued";
  const canSku = ctx.can("masterdata.sku.create") && p.status !== "discontinued";
  const families = await productFamilies(db, ctx.organizationId, { keep: p.family });
  const familyLabel = families.find((f) => f.value === p.family)?.label.replace(/ \(no longer used\)$/, "") ?? p.family;
  const units = await uomOptions(db, ctx.organizationId);
  const moves = ctx.can("masterdata.product.edit") ? (PRODUCT_TRANSITIONS[p.status as ProductStatus] ?? []) : [];
  const recipe = ctx.can("masterdata.formula.view") ? ((await listFormulas(ctx)).find((f) => f.productId === p.id) ?? null) : null;
  const canWizard = ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create");
  const months = daysToWholeMonths(p.shelfLifeDays);
  const ready = moves.includes("active");
  const stop = moves.includes("discontinued");

  return (
    <div className="space-y-5">
      <PageHeader
        title={p.name}
        subtitle={
          <>
            {familyLabel} · {fmtQty(p.unitNetMassG, "g", 0)} a piece · {shelfText(p.shelfLifeDays)} · <RecordNo>{p.code}</RecordNo> <PlainItemChip status={p.status} />
          </>
        }
        actions={
          <>
            <LinkButton href="/masterdata/products" variant="secondary">All products</LinkButton>
            {(stop || (p.status === "draft" && (ctx.can("masterdata.product.edit") || ctx.can("masterdata.product.create")))) && (
              <MoreMenu>
                <div className="flex flex-col gap-4">
                  {stop && (
                    <ActionForm action={productStatusAction} submitLabel="No longer made" variant="danger" hidden={{ _id: p.id, status: "discontinued" }}>
                      <p className="text-[13px] text-muted">Final: its sellable items stop too. Batches and stock already made keep it.</p>
                      <TextField name="reason" label="Why?" />
                    </ActionForm>
                  )}
                  {p.status === "draft" && (ctx.can("masterdata.product.edit") || ctx.can("masterdata.product.create")) && (
                    <div>
                      <p className="mb-2 text-[13px] text-muted">Still a draft. If nothing uses it yet (no recipe, batch, order or stock), you can delete it with its sellable items.</p>
                      <DeleteDraftButton kind="product" id={p.id} what="this product" />
                    </div>
                  )}
                </div>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>This screen is for one product: its basic facts and the ways it is sold. The recipe (ingredients and steps) is made step by step.</PageIntro>
      {created === "1" && <Banner tone="ok" title={`${p.name} added as ${p.code}`}>Next: add how it is sold, then make it ready to use.</Banner>}

      {recipe ? (
        <NextStep
          text={recipe.effective ? `The recipe for ${p.name} is approved (version ${recipe.effective.revisionNo}).` : `The recipe for ${p.name} is not approved yet.`}
          action={{ label: "Open the recipe", href: `/masterdata/recipes/${recipe.formulaId}` }}
        />
      ) : canWizard && p.status !== "discontinued" ? (
        <NextStep className={NEXT_WRAP} text={`Next: make the recipe for ${p.name}: ingredients, amounts and steps, one screen at a time.`} action={{ label: "Make a recipe (step by step)", href: `/masterdata/recipes/new?product=${p.id}` }} />
      ) : (
        <NextStep className={NEXT_WRAP} text="This product has no recipe yet." waitingFor="The planner makes the recipe step by step; QA approves it." />
      )}

      {ready && (
        <Card>
          <CardTitle>Ready to use?</CardTitle>
          <ActionForm action={productStatusAction} submitLabel="Make it ready to use" variant="primary" hidden={{ _id: p.id, status: "active", reason: "" }}>
            <p className="text-[14px] text-fg-2">It is a draft. When the facts below are right, make it ready so batches can make it and customers can order it.</p>
          </ActionForm>
        </Card>
      )}

      <Card>
        <CardTitle>How it is sold ({p.skus.length})</CardTitle>
        <div className="-mt-2 mb-2">
          <WhatIs label="What is a sellable item?">{SELLABLE_ITEM_TEXT}</WhatIs>
        </div>
        {!ctx.can("masterdata.sku.view") ? (
          <p className="text-[14px] text-muted">Your job does not include sellable items.</p>
        ) : p.skus.length === 0 ? (
          <p className="text-[14px] text-fg-2">{canSku ? "Not yet. Add one below: for example one bar, or a box of 12." : "Not yet. Ask the planner to add how it is sold."}</p>
        ) : (
          <PlainList label="Sellable items">
            {p.skus.map((s) => (
              <PlainRow
                key={s.id}
                href={`/masterdata/products/${p.id}/skus/${s.id}`}
                title={s.name}
                code={s.code}
                status={s.status !== "active" ? <PlainItemChip status={s.status} /> : undefined}
                facts={[s.variantLabel, s.netContentQty ? `${fmtQty(s.netContentQty, "", 0)} ${units.find((u) => u.id === s.netContentUomId)?.code ?? ""} inside` : null, s.gtin ? "has a barcode" : null].filter(Boolean).join(" · ") || "No pack size yet"}
              />
            ))}
          </PlainList>
        )}
        {canSku && (
          <details className="mt-4 border-t border-line pt-2" id="sell">
            <summary className="flex min-h-[48px] cursor-pointer items-center font-medium text-primary-text">Add a way to sell it (pack size)</summary>
            <div className="mt-3">
              <ActionForm action={saveSkuAction} submitLabel="Add sellable item" pendingText="Adding…" variant="cta" hidden={{ productId: p.id }}>
                <SkuFields units={units} defaults={{ name: p.name, unitsPerBox: p.unitsPerBox, netContentQty: p.unitNetMassG }} />
              </ActionForm>
            </div>
          </details>
        )}
      </Card>

      <Card>
        <CardTitle>Basic facts</CardTitle>
        {canEdit ? (
          <ActionForm action={saveProductAction} submitLabel="Save" hidden={{ _id: p.id }}>
            <ProductFields families={families} d={{ ...p, code: p.code }} months={months} />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this product" />
        )}
      </Card>
    </div>
  );
}
