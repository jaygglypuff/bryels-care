import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtQty } from "@/lib/qty";
import { db } from "@/db/client";
import { PRODUCT_STATUSES, listProducts, productFamilies } from "@/modules/masterdata";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td } from "@/ui/core";
import { Forbidden } from "../../forbidden";
import { ActionForm, Grid, SelectField, TextField } from "../_org/form";
import { saveProductAction } from "../_org/actions";
import { AddCard, StateChip } from "../_org/ui";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; family?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.product.view")) return <Forbidden what="products" />;
  const sp = await searchParams;
  const rows = await listProducts(ctx, { q: sp.q, status: sp.status, family: sp.family });
  const families = await productFamilies(db, ctx.organizationId);
  const familyLabel = new Map(families.map((f) => [f.value, f.label]));
  const filtered = !!(sp.q || sp.status || sp.family);
  const canCreate = ctx.can("masterdata.product.create");
  const qs = new URLSearchParams(Object.entries({ q: sp.q ?? "", status: sp.status ?? "", family: sp.family ?? "" }).filter(([, v]) => v)).toString();
  const sites = ctx.allowedSites.map((s) => s.code).join(", ");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Products"
        subtitle={`Finished goods and their SKUs (organization-wide). On hand is across your sites (${sites}).`}
        actions={
          ctx.can("masterdata.product.export") ? (
            <a href={`/api/v1/masterdata/export/products${qs ? `?${qs}` : ""}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
              Export CSV
            </a>
          ) : undefined
        }
      />
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px]">
            Search
            <Input name="q" defaultValue={sp.q} placeholder="Code or name" />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Family
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
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Filter</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title={filtered ? "No products match" : "No products yet"} action={filtered ? <LinkButton href="/masterdata/products" variant="secondary">Clear filters</LinkButton> : undefined}>
          {filtered ? "Try another filter." : "Products are the finished goods made from approved formulas."}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/masterdata/products/${p.id}`}>
                  <Card>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-semibold">{p.code}</span>
                      <StateChip status={p.status} />
                    </div>
                    <p className="font-medium">{p.name}</p>
                    <p className="mt-1 text-[12px] text-muted tabular">
                      {familyLabel.get(p.family) ?? p.family} · {fmtQty(p.unitNetMassG, "g", 0)} net · {p.unitsPerBox}/box · {p.shelfLifeDays} days · {p.skuCount} SKU{p.skuCount === 1 ? "" : "s"}
                    </p>
                    <p className="mt-1 text-[13px] tabular">On hand {fmtQty(p.onHand, "pcs", 0)}</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table head={["Code", "Name", "Family", "Status", "Net mass", "Units per box", "Shelf life", "SKUs", "On hand"]}>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <Td className="font-mono font-semibold">
                    <Link href={`/masterdata/products/${p.id}`} className="text-primary-text hover:underline">{p.code}</Link>
                  </Td>
                  <Td>{p.name}</Td>
                  <Td>{familyLabel.get(p.family) ?? p.family}</Td>
                  <Td><StateChip status={p.status} /></Td>
                  <Td className="whitespace-nowrap">{fmtQty(p.unitNetMassG, "g", 0)}</Td>
                  <Td>{p.unitsPerBox}</Td>
                  <Td className="whitespace-nowrap">{p.shelfLifeDays} days</Td>
                  <Td>{p.skuCount}</Td>
                  <Td className="whitespace-nowrap text-right">{fmtQty(p.onHand, "pcs", 0)}</Td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
      {canCreate && (
        <AddCard title="Add a product">
          <ActionForm action={saveProductAction} submitLabel="Create product (draft)" variant="cta">
            <Grid>
              <TextField name="code" label="Code" placeholder="CCS-100" mono hint="Unique; scan-safe (capital letters, digits, . - _)." />
              <TextField name="name" label="Name" placeholder="Calamansi Cream Soap 100 g" />
              <SelectField name="family" label="Family" options={families} hint="To add a family, go to Master data → Lists." />
              <TextField name="unitNetMassG" label="Net mass per unit (g)" inputMode="decimal" placeholder="100" />
              <TextField name="unitsPerBox" label="Units per box" inputMode="numeric" placeholder="48" />
              <TextField name="shelfLifeDays" label="Shelf life (days)" inputMode="numeric" placeholder="730" hint="Shelf-life values are confirmed by QA." />
              <TextField name="storageConditions" label="Storage conditions (optional)" />
            </Grid>
          </ActionForm>
        </AddCard>
      )}
    </div>
  );
}
