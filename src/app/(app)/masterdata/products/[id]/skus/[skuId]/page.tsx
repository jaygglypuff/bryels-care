import Link from "next/link";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { PRODUCT_TRANSITIONS, getProduct, getSku, uomOptions, type ProductStatus } from "@/modules/masterdata";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { RecordNo } from "@/ui/plain-list";
import { Banner } from "@/ui/status";
import { Forbidden } from "../../../../../forbidden";
import { ActionForm, TextField } from "../../../../_org/form";
import { saveSkuAction, skuStatusAction } from "../../../../_org/actions";
import { ReadOnlyNote } from "../../../../_org/ui";
import { PlainItemChip, SELLABLE_ITEM_TEXT, WhatIs, NEXT_WRAP } from "../../../../_eng/plain";
import { SkuFields } from "../../sku-fields";

export const metadata = { title: "Sellable item" };

export default async function SkuPage({ params, searchParams }: { params: Promise<{ id: string; skuId: string }>; searchParams: Promise<{ created?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.sku.view")) return <Forbidden what="sellable items" />;
  const { id, skuId } = await params;
  const { created } = await searchParams;
  let s;
  try {
    s = await getSku(ctx, skuId);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found")
      return (
        <EmptyState title="Sellable item not found" action={<LinkButton href={`/masterdata/products/${id}`} variant="secondary">Back to the product</LinkButton>}>
          It may have been deleted. Open the product to see how it is sold.
        </EmptyState>
      );
    throw e;
  }
  const product = ctx.can("masterdata.product.view") ? await getProduct(ctx, s.productId).catch(() => null) : null;
  const units = await uomOptions(db, ctx.organizationId);
  const canEdit = ctx.can("masterdata.sku.edit") && s.status !== "discontinued";
  const moves = ctx.can("masterdata.sku.edit") ? (PRODUCT_TRANSITIONS[s.status as ProductStatus] ?? []) : [];
  const back = `/masterdata/products/${s.productId}`;
  const productReady = product?.status === "active";

  return (
    <div className="space-y-5">
      <Link href={back} className="inline-flex min-h-[44px] items-center text-[14px] text-primary-text hover:underline">
        ← {product ? product.name : "Back to the product"}
      </Link>
      <PageHeader
        title={s.name}
        subtitle={
          <>
            Sellable item{product ? ` of ${product.name}` : ""}
            {s.variantLabel ? ` · ${s.variantLabel}` : ""} · <RecordNo>{s.code}</RecordNo> <PlainItemChip status={s.status} />
          </>
        }
        actions={
          <>
            {moves.includes("discontinued") && (
              <MoreMenu>
                <ActionForm action={skuStatusAction} submitLabel="No longer sold" variant="danger" hidden={{ _id: s.id, status: "discontinued" }}>
                  <p className="text-[13px] text-muted">Final. Orders and stock that already have it keep it.</p>
                  <TextField name="reason" label="Why?" />
                </ActionForm>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>
        This screen is for one way the product is sold (a pack size): its name, what is inside and its barcode. <WhatIs label="What is a sellable item?">{SELLABLE_ITEM_TEXT}</WhatIs>
      </PageIntro>
      {created === "1" && <Banner tone="ok" title={`${s.name} added as ${s.code}`}>It is a draft until you make it ready to sell.</Banner>}

      {s.status === "draft" && moves.includes("active") ? (
        productReady ? (
          <NextStep className={NEXT_WRAP} text="Next: check the facts below, then make it ready to sell." action={{ label: "Make it ready to sell", href: "#ready" }} />
        ) : (
          <NextStep className={NEXT_WRAP} text="The product itself is still a draft." waitingFor="Make the product ready to use first, then this sellable item." action={{ label: "Open the product", href: back }} />
        )
      ) : s.status === "active" ? (
        <NextStep className={NEXT_WRAP} text="This sellable item is ready to sell." action={{ label: "Back to the product", href: back }} />
      ) : s.status === "discontinued" ? (
        <NextStep className={NEXT_WRAP} text="This sellable item is no longer sold." action={{ label: "Back to the product", href: back }} />
      ) : (
        <NextStep className={NEXT_WRAP} text="This sellable item is a draft." waitingFor="The planner makes it ready to sell." />
      )}

      {s.status === "draft" && moves.includes("active") && productReady && (
        <section id="ready" className="scroll-mt-20">
          <Card>
            <CardTitle>Ready to sell?</CardTitle>
            <ActionForm action={skuStatusAction} submitLabel="Make it ready to sell" variant="primary" hidden={{ _id: s.id, status: "active", reason: "" }}>
              <p className="text-[14px] text-fg-2">Customers can order it and boxes can be packed once it is ready.</p>
            </ActionForm>
          </Card>
        </section>
      )}

      <Card>
        <CardTitle>Facts</CardTitle>
        {canEdit ? (
          <ActionForm action={saveSkuAction} submitLabel="Save" hidden={{ _id: s.id, productId: s.productId }}>
            <SkuFields units={units} defaults={s} />
          </ActionForm>
        ) : (
          <ReadOnlyNote what="this sellable item" />
        )}
      </Card>
    </div>
  );
}
