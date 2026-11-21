import Link from "next/link";
import type { AuthContext } from "@/lib/auth/context";
import { plural } from "@/lib/plural";
import { shopShelfStatus } from "@/modules/inventory";
import { LinkButton } from "@/ui/core";
import { Panel } from "@/ui/kit";
import { Chip } from "@/ui/status";

/**
 * ADR-138 §3 on Home (warehouse and sales desk): today's take-outs, and the open boxes or online shop shelf stock with
 * nothing written down for `inventory.takeout.stale_days` days, each with "Count". The buttons open Take a few out
 * and Count what's left. Renders nothing for people who may not take pieces out.
 */
export async function ShopShelfCard({ ctx }: { ctx: AuthContext }) {
  if (!ctx.can("inventory.takeout.create")) return null;
  const s = await shopShelfStatus(ctx).catch(() => null);
  if (!s) return null;
  const quiet = s.stale.slice(0, 4);
  return (
    <Panel
      title="Online shop shelf and open boxes"
      count={s.stale.length || null}
      testId="home-shop-shelf"
      id="home-shop-shelf"
      className="mb-4"
      action={<LinkButton href="/inventory/take-out" variant="secondary" size="sm">Take a few out</LinkButton>}
      footer={
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-fg-2">
            Today: {s.today.entries === 0 ? "nothing taken out yet" : `${plural(s.today.entries, "take-out", "take-outs")}, ${plural(Number(s.today.pieces), "piece", "pieces")}`}
          </span>
          <Link className="font-medium text-primary-text hover:underline" href="/inventory/take-out/count">
            Count what&apos;s left
          </Link>
        </span>
      }
      flush
    >
      {quiet.length === 0 ? (
        <p className="px-4 py-3 text-[14px] text-fg-2">{s.rows.length === 0 ? "No open boxes. When you take pieces from a box, it shows here." : `Every open box had a take-out or a count in the last ${s.staleDays} days.`}</p>
      ) : (
        <ul className="divide-y divide-line">
          {quiet.map((r) => (
            <li key={`${r.kind}:${r.containerId ?? r.lotId + r.locationId}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0 text-[14px]">
                <span className="block font-medium">
                  {r.productName} · {r.kind === "box" ? `box ${r.boxNumber}` : `loose on ${r.locationCode}`}
                </span>
                <span className="block text-[13px] text-fg-2">
                  {r.pieces} left says the app · {r.locationName}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Chip tone="warn">Not counted for {r.days} days</Chip>
                <LinkButton href={r.containerId ? `/inventory/take-out/count?box=${r.containerId}` : `/inventory/take-out/count?lot=${r.lotId}&location=${r.locationId}`} variant="secondary" size="sm">
                  Count
                </LinkButton>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
