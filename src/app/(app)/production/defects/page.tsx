import type { Metadata } from "next";
import { requireContext } from "@/lib/auth/context";
import { addDays, defectSummary, listProducts, manilaToday } from "@/modules/production";
import { Card, PageHeader, Select } from "@/ui/core";
import { Help } from "@/ui/help/help";
import { Forbidden } from "../../forbidden";
import { DefectTables } from "../orders/parts";
import { PageIntro } from "@/ui/guide";

export const metadata: Metadata = { title: "Rejects" };
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Owner view (ADR-074, ADR-080 words): good pieces vs rejects per product and day, and reject % by type, from the daily logs. The table keeps its name (production_defect_entries). */
export default async function DefectsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; productId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("production.daily_log.view")) return <Forbidden what="the rejects summary" />;
  const sp = await searchParams;
  const to = sp.to && ISO.test(sp.to) ? sp.to : manilaToday();
  const from = sp.from && ISO.test(sp.from) ? sp.from : addDays(to, -29);
  const summary = await defectSummary(ctx, { from, to, productId: sp.productId });
  const products = ctx.can("masterdata.product.view") ? await listProducts(ctx) : [];
  return (
    <div>
      <PageHeader title="Rejects" subtitle={ctx.currentSite.name} actions={<Help screen="production.production_order" />} />
      <PageIntro>How many pieces were thrown away, and why, from the daily logs.</PageIntro>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          From
          <input type="date" name="from" defaultValue={from} className="min-h-[44px] rounded-[14px] border border-line-strong bg-surface px-3.5 text-[14px]" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          To
          <input type="date" name="to" defaultValue={to} className="min-h-[44px] rounded-[14px] border border-line-strong bg-surface px-3.5 text-[14px]" />
        </label>
        {products.length > 0 && (
          <label className="flex min-w-[180px] flex-col gap-1 text-[13px] font-medium">
            Product
            <Select name="productId" defaultValue={sp.productId ?? ""}>
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </label>
        )}
        <button className="min-h-[44px] rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2" type="submit">Show</button>
      </form>
      <Card>
        <DefectTables summary={summary} />
      </Card>
      <p className="mt-4 text-[13px] text-muted">Reject rate = rejects ÷ (good + rejects). A corrected entry counts once, with the corrected numbers.</p>
    </div>
  );
}
