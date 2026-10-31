import { requireContext } from "@/lib/auth/context";
import { expiryAlerts } from "@/modules/inventory/lots-admin";
import { EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { Expiry, LotStatusChip, fmtLotQty } from "@/ui/inventory/bits";
import { Forbidden } from "../../../forbidden";

export const metadata = { title: "Expiring soon" };

/**
 * US-2-16 expiry list (A-KPI-03 buckets from settings), grade-5 (ADR-088): item first, the expiry date
 * with days left, how much is left on the right in friendly units, lot number small and grey. The order is
 * "use the one that expires first" (FEFO, a hidden rule). The nightly notification job (expiring_lot
 * notifications to site_manager and qa_qc) needs the jobs platform (US-2-03).
 */
export default async function ExpiryPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.lot.view")) return <Forbidden what="expiry dates" />;
  const { buckets, rows } = await expiryAlerts(ctx);
  const groups = ["expired", ...buckets.map((b) => `≤ ${b} days`)];
  const title = (g: string) => (g === "expired" ? "Already expired, still in stock" : `Expires within ${g.replace("≤ ", "")}`);
  return (
    <div className="space-y-4">
      <PageHeader title="Expiring soon" subtitle={ctx.currentSite.name} />
      <PageIntro>
        This screen is for stock that has expired or expires within {buckets.at(-1)} days, the earliest first. Use the one that expires first; move expired stock out of the way and tell QA.
      </PageIntro>
      <div className="flex flex-wrap gap-2" aria-label="How many in each group">
        {groups.map((g) => (
          <Chip key={g} tone={g === "expired" ? "bad" : "warn"}>
            {g === "expired" ? "Expired" : `Within ${g.replace("≤ ", "")}`}: {rows.filter((r) => r.bucket === g).length}
          </Chip>
        ))}
      </div>
      {rows.length === 0 && (
        <EmptyState title="Nothing expires soon" action={<LinkButton href="/inventory" variant="secondary">See all stock</LinkButton>}>
          No stock at {ctx.currentSite.name} has expired or expires within {buckets.at(-1)} days. Nothing to do.
        </EmptyState>
      )}
      {rows.length > 0 &&
        groups.map((g) => {
          const list = rows.filter((r) => r.bucket === g);
          if (list.length === 0) return null;
          return (
            <section key={g} className="space-y-2">
              <h2 className={g === "expired" ? "text-[16px] font-semibold text-[var(--bad-fg)]" : "text-[16px] font-semibold"}>{title(g)} · {list.length}</h2>
              <PlainList label={title(g)}>
                {list.map((r) => (
                  <PlainRow
                    key={r.id}
                    href={`/inventory/${r.id}`}
                    title={r.itemName}
                    status={<LotStatusChip status={r.qualityStatus} expiresOn={r.expiresOn} />}
                    tone={g === "expired" ? "bad" : undefined}
                    facts={
                      <>
                        <Expiry date={r.expiresOn} compact /> {r.locationCodes ? ` · on ${r.locationCodes}` : ""}
                      </>
                    }
                    code={r.lotNumber}
                    aside={<span className="font-semibold tabular text-[15px] text-fg">{fmtLotQty(r.onHand, r.baseUom)}</span>}
                  />
                ))}
              </PlainList>
            </section>
          );
        })}
    </div>
  );
}
