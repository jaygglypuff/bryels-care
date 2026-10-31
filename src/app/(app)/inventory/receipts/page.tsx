import Link from "next/link";
import { Search } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listReceipts } from "@/modules/inventory/receiving";
import { EmptyState, Input, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { MoreMenu } from "@/ui/more-menu";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { ReceiptStatusChip } from "@/ui/receiving";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Deliveries received" };

const TABS = [
  ["", "All"],
  ["draft", "Not finished"],
  ["posted", "Saved to stock"],
  ["reversed", "Undone"],
  ["cancelled", "Cancelled"],
] as const;

/** Deliveries received (goods receipts), grade-5 (ADR-088): supplier first, receipt number small and grey. */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; open?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("procurement.goods_receipt.view")) return <Forbidden what="deliveries received" />;
  const sp = await searchParams;
  const status = TABS.some(([k]) => k && k === sp.status) ? sp.status : undefined;
  const q = sp.q?.trim() ?? "";
  const rows = await listReceipts(ctx, { status, q, openDiscrepancies: sp.open === "1" });
  const filtered = !!(status || q || sp.open);
  const exportQs = new URLSearchParams(Object.entries({ status: status ?? "", q }).filter(([, v]) => v)).toString();
  const link = (over: { status?: string; open?: string }) => {
    const p = new URLSearchParams();
    const all = { status, q: q || undefined, open: sp.open, ...over };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const s = p.toString();
    return `/inventory/receipts${s ? `?${s}` : ""}`;
  };
  const canCreate = ctx.can("procurement.goods_receipt.create");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Deliveries received"
        subtitle={ctx.currentSite.name}
        actions={
          <>
            {canCreate && <LinkButton href="/inventory/receive" variant="cta">Receive a delivery</LinkButton>}
            <MoreMenu>
              <div className="flex flex-col gap-2">
                {ctx.can("procurement.goods_receipt.export") && (
                  <a href={`/api/v1/procurement/goods-receipts/export${exportQs ? `?${exportQs}` : ""}`} className={buttonClass("secondary")}>
                    Download as CSV
                  </a>
                )}
                <LinkButton href={link({ open: sp.open === "1" ? undefined : "1" })} variant="secondary">{sp.open === "1" ? "Show all deliveries" : "Only deliveries with a problem"}</LinkButton>
                {ctx.can("inventory.movement.post") && <LinkButton href="/inventory/receive/put-away" variant="secondary">Put away</LinkButton>}
              </div>
            </MoreMenu>
          </>
        }
      />
      <PageIntro>This screen is for every delivery written down at this site, newest first: unfinished ones, saved ones, and ones that were undone. Tap one to see it.</PageIntro>
      <form method="get" className="flex flex-wrap gap-2" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        {sp.open === "1" && <input type="hidden" name="open" value="1" />}
        <div className="relative min-w-0 flex-1 basis-[220px] sm:max-w-[420px]">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input type="search" name="q" defaultValue={q} placeholder="Supplier name" aria-label="Search deliveries" className="pl-10" />
        </div>
        <button type="submit" className={buttonClass("secondary")}>Search</button>
        {q && <Link href={link({})} className={buttonClass("ghost")}>Clear</Link>}
      </form>
      <FilterTabs label="Filter by state" active={status ?? ""} tabs={TABS.map(([k, t]) => [k, t, link({ status: k || undefined })] as const)} />
      {sp.open === "1" && <p className="text-[13px] text-fg-2">Showing only deliveries with a problem not yet sorted out.</p>}
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No deliveries match" : "No deliveries yet"}
          action={filtered ? <LinkButton href="/inventory/receipts" variant="secondary">Show all</LinkButton> : canCreate ? <LinkButton href="/inventory/receive" variant="cta">Receive a delivery</LinkButton> : undefined}
        >
          {filtered ? "Try another supplier name or state." : canCreate ? "When a delivery arrives, tap Receive a delivery." : "Deliveries written down at this site show here."}
        </EmptyState>
      ) : (
        <PlainList label="Deliveries received">
          {rows.map((r) => (
            <PlainRow
              key={r.id}
              href={`/inventory/receive/${r.id}`}
              title={r.supplierName}
              status={
                <>
                  <ReceiptStatusChip status={r.status} />
                  {r.openDiscrepancies > 0 && <Chip tone="warn">{r.openDiscrepancies} problem{r.openDiscrepancies === 1 ? "" : "s"}</Chip>}
                  {r.documentsMissing > 0 && <Chip tone="warn">Certificate missing</Chip>}
                  {!r.supplierId && <Chip tone="warn">Supplier not in the list</Chip>}
                </>
              }
              facts={
                <>
                  {fmtDateTime(r.receivedAt)} · {r.lineCount} {r.lineCount === 1 ? "item" : "items"} · {r.receivedByName}
                </>
              }
              code={r.receiptNumber ?? undefined}
              tone={r.openDiscrepancies > 0 ? "warn" : undefined}
            />
          ))}
        </PlainList>
      )}
    </div>
  );
}
