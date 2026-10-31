import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { fmtQty } from "@/lib/qty";
import { db } from "@/db/client";
import { PRODUCT_STATUSES, listProducts, productFamilies } from "@/modules/masterdata";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Forbidden } from "../../forbidden";
import { ActionForm } from "../_org/form";
import { saveProductAction } from "../_org/actions";
import { PlainItemChip, NEXT_WRAP } from "../_eng/plain";
import { ProductFields } from "./product-fields";
import { shelfText } from "./words";

export const metadata: Metadata = { title: "Products" };

const STATUS_WORDS: Record<string, string> = { draft: "Draft", active: "Ready to use", discontinued: "No longer made" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; family?: string; new?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.product.view")) return <Forbidden what="products" />;
  const sp = await searchParams;
  const rows = await listProducts(ctx, { q: sp.q, status: sp.status, family: sp.family });
  const families = await productFamilies(db, ctx.organizationId);
  const familyLabel = new Map(families.map((f) => [f.value, f.label]));
  const filtered = !!(sp.q || sp.status || sp.family);
  const canCreate = ctx.can("masterdata.product.create");
  const canWizard = ctx.can("masterdata.formula.create") && ctx.can("masterdata.routing.create");
  const qs = new URLSearchParams(Object.entries({ q: sp.q ?? "", status: sp.status ?? "", family: sp.family ?? "" }).filter(([, v]) => v)).toString();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Products"
        actions={
          <>
            {canCreate && <LinkButton href="/masterdata/products?new=1#new-product" variant="secondary">New product</LinkButton>}
            {ctx.can("masterdata.product.export") && (
              <MoreMenu>
                <a href={`/api/v1/masterdata/export/products${qs ? `?${qs}` : ""}`} className="inline-flex min-h-[44px] items-center text-[14px] font-medium text-primary-text underline">
                  Download the list (Excel / CSV)
                </a>
              </MoreMenu>
            )}
          </>
        }
      />
      <PageIntro>
        This screen is for the things you make and sell (soap bars, lotions…): name, size and how long they stay good. Most people make a new product inside New recipe (step by step).
      </PageIntro>
      {canWizard && <NextStep className={NEXT_WRAP} text="Making a new product? The step-by-step recipe asks for the product, the ingredients and the steps in one go." action={{ label: "Make a recipe (step by step)", href: "/masterdata/recipes/new" }} />}
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px]">
            Search
            <Input name="q" defaultValue={sp.q} placeholder="Name or number" />
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Search</button>
          <div className="w-full">
            <MoreDetails title="More filters">
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-[13px]">
                  What kind
                  <Select name="family" defaultValue={sp.family ?? ""}>
                    <option value="">All</option>
                    {families.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  Status
                  <Select name="status" defaultValue={sp.status ?? ""}>
                    <option value="">All</option>
                    {PRODUCT_STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_WORDS[s] ?? s}</option>
                    ))}
                  </Select>
                </label>
              </div>
            </MoreDetails>
          </div>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No products match" : "No products yet"}
          action={filtered ? <LinkButton href="/masterdata/products" variant="secondary">Clear search</LinkButton> : canWizard ? <LinkButton href="/masterdata/recipes/new">Make a recipe (step by step)</LinkButton> : undefined}
        >
          {filtered ? "Try another word, or clear the search." : canCreate ? "Make your first product with New recipe (step by step), or add it below." : "Ask the owner or the planner to add products."}
        </EmptyState>
      ) : (
        <PlainList label="Products">
          {rows.map((p) => (
            <PlainRow
              key={p.id}
              href={`/masterdata/products/${p.id}`}
              title={p.name}
              code={p.code}
              status={p.status !== "active" ? <PlainItemChip status={p.status} /> : undefined}
              facts={`${familyLabel.get(p.family) ?? p.family} · ${fmtQty(p.unitNetMassG, "g", 0)} a piece · ${shelfText(p.shelfLifeDays)} · ${p.skuCount} way${p.skuCount === 1 ? "" : "s"} to sell`}
              aside={<span className="tabular">{fmtQty(p.onHand, "pcs", 0)}<span className="block text-[11px] text-muted">in stock</span></span>}
            />
          ))}
        </PlainList>
      )}
      {canCreate && (
        <section id="new-product" className="scroll-mt-20">
          <Card>
            <details open={sp.new === "1"}>
              <summary className="flex min-h-[48px] cursor-pointer select-none items-center font-display text-[17px] font-semibold text-fg">Add a product here (without a recipe)</summary>
              <p className="mt-2 text-[14px] text-fg-2">Five questions. The system gives it a number. It starts as a draft; add how it is sold on the next screen.</p>
              <div className="mt-4">
                <ActionForm action={saveProductAction} submitLabel="Add product" pendingText="Adding…" variant="cta">
                  <ProductFields families={families} />
                </ActionForm>
              </div>
            </details>
          </Card>
        </section>
      )}
    </div>
  );
}
