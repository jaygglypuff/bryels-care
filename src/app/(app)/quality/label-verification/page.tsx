import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { labelVerificationLocations, labelVerificationZone } from "@/modules/quality";
import { Card, CardTitle, EmptyState, PageHeader, cx } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { VerifyScanForm } from "../w2c-forms";

export const dynamic = "force-dynamic";

/** US-2-24: scan every newly labelled box or loose lot in a zone and watch the remaining list shrink (MC-06). */
export default async function LabelVerificationPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.label_job.view")) return <Forbidden what="label verification" />;
  const { locationId } = await searchParams;
  const zones = await labelVerificationLocations(ctx);
  let zone: Awaited<ReturnType<typeof labelVerificationZone>> | null = null;
  if (locationId) {
    try {
      zone = await labelVerificationZone(ctx, locationId);
    } catch (e) {
      if (!(e instanceof DomainError && e.code === "not_found")) throw e;
    }
  }
  return (
    <>
      <PageHeader title="Label verification" subtitle={`${ctx.currentSite.code} · scan each labelled box or lot in a zone; the container itself does not change`} />
      <div className="flex flex-col gap-5">
        <Card>
          <CardTitle>Zone</CardTitle>
          {zones.length === 0 ? (
            <EmptyState title="No zones">This site has no active locations.</EmptyState>
          ) : (
            <nav className="flex flex-wrap gap-2" aria-label="Choose a zone">
              {zones.map((z) => (
                <Link key={z.id} href={`/quality/label-verification?locationId=${z.id}`} className={cx("rounded-full border px-3 py-1.5 text-[13px]", z.id === locationId ? "border-ring bg-primary-soft font-medium" : "border-line hover:bg-surface-2")}>
                  {z.code}
                  {z.boxes > 0 && <span className="ml-1 text-muted">({z.verifiedBoxes}/{z.boxes} boxes)</span>}
                </Link>
              ))}
            </nav>
          )}
          {locationId && !zone && <p className="mt-3 text-[13px] text-[var(--bad-fg)]">That zone is not at your current site.</p>}
        </Card>
        {zone && (
          <>
            <Card>
              <CardTitle action={<Chip tone={zone.targetMet ? "ok" : "warn"}>{zone.verifiedPct} % verified · target {zone.targetPct} %</Chip>}>
                {zone.location.code} · {zone.location.name}
              </CardTitle>
              <p className="mb-3 text-[13px] text-muted">
                {zone.verified} of {zone.total} label(s) verified, {zone.remaining.length} remaining.
              </p>
              {zone.canScan ? <VerifyScanForm locationId={zone.location.id} /> : <Banner tone="info" title="View only">Scanning needs inventory.container.edit (warehouse operators).</Banner>}
            </Card>
            <Card>
              <CardTitle>Remaining ({zone.remaining.length})</CardTitle>
              {zone.remaining.length === 0 ? (
                <EmptyState title="Every label in this zone is verified">Move to the next zone.</EmptyState>
              ) : (
                <ul className="flex flex-col divide-y divide-line text-[14px]">
                  {zone.remaining.map((i) => (
                    <li key={`${i.kind}:${i.id}`} className="flex flex-wrap items-center gap-2 py-2">
                      <Chip tone="neu">{i.kind === "box" ? "Box" : "Lot"}</Chip>
                      <span className="font-medium">{i.number}</span>
                      <span className="text-muted">{i.kind === "box" ? i.lotNumber ?? "empty" : i.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardTitle>Verified ({zone.verified})</CardTitle>
              {zone.verified === 0 ? (
                <p className="text-[13px] text-muted">Nothing verified yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line text-[13px]">
                  {zone.items
                    .filter((i) => i.verifiedAt)
                    .map((i) => (
                      <li key={`${i.kind}:${i.id}`} className="py-1.5">
                        {i.kind === "box" ? "Box" : "Lot"} {i.number} · {fmtDateTime(i.verifiedAt)} · {i.verifiedByName}
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
