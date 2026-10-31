import Link from "next/link";
import { Search } from "lucide-react";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listContainers } from "@/modules/inventory/containers";
import { EmptyState, Input, LinkButton, PageHeader, buttonClass } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { FilterTabs, PlainList, PlainRow } from "@/ui/plain-list";
import { Chip } from "@/ui/status";
import { BOX_STATUS_WORDS, LotStatusChip } from "@/ui/inventory/bits";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Boxes and sacks" };

const STATUSES = ["open", "sealed", "in_transit", "empty", "void", "shipped"];

/**
 * Boxes and sacks (containers), grade-5 (ADR-088): what is inside by name first, the shelf in words, the box
 * number small and grey. One list on phone and desktop; quality status always comes from the lot.
 */
export default async function ContainersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.view")) return <Forbidden what="boxes and sacks" />;
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const q = sp.q?.trim() ?? "";
  const rows = await listContainers(ctx, { q, status });
  const filtered = !!(q || status);
  const withQ = (href: string) => (q ? `${href}${href.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : href);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Boxes and sacks"
        subtitle={ctx.currentSite.name}
        actions={ctx.can("inventory.container.create") ? <LinkButton href="/inventory/containers/new" variant="cta">Pack into a box</LinkButton> : undefined}
      />
      <PageIntro>This screen is for boxes and sacks that hold stock: what is inside, which shelf they are on, and if they are open or closed. Scan a box label or tap a row to open it.</PageIntro>
      <form method="get" className="flex flex-wrap gap-2" role="search">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative min-w-0 flex-1 basis-[220px] sm:max-w-[420px]">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Box or lot number from the label" aria-label="Search boxes" className="pl-10" />
        </div>
        <button type="submit" className={buttonClass("secondary")}>Search</button>
        {q && <Link href={status ? `/inventory/containers?status=${status}` : "/inventory/containers"} className={buttonClass("ghost")}>Clear</Link>}
      </form>
      <FilterTabs
        label="Box state"
        active={status ?? ""}
        tabs={[["", "In use", withQ("/inventory/containers")] as const, ...["sealed", "open", "in_transit", "empty", "shipped"].map((s) => [s, BOX_STATUS_WORDS[s], withQ(`/inventory/containers?status=${s}`)] as const)]}
      />
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No boxes or sacks match" : "No boxes or sacks here yet"}
          action={filtered ? <LinkButton href="/inventory/containers" variant="secondary">Show all in use</LinkButton> : ctx.can("inventory.container.create") ? <LinkButton href="/inventory/containers/new" variant="cta">Pack into a box</LinkButton> : undefined}
        >
          {filtered ? "Try another number or state." : "Pack loose stock into a box or sack to find it by its label."}
        </EmptyState>
      ) : (
        <PlainList label="Boxes and sacks">
          {rows.map((b) => (
            <PlainRow
              key={b.id}
              href={`/inventory/containers/${b.id}`}
              title={b.itemNames ?? "Empty"}
              status={
                <>
                  <Chip tone={b.status === "sealed" ? "ok" : b.status === "open" ? "info" : "neu"}>{BOX_STATUS_WORDS[b.status] ?? b.status}</Chip>
                  {(b.qualityStatuses ?? "").split(",").filter((s) => s && s !== "released").map((s) => <LotStatusChip key={s} status={s} />)}
                </>
              }
              facts={
                <>
                  {b.locationName ? `On ${b.locationName}` : "No shelf yet"}
                  {b.packedAt ? ` · packed ${fmtDate(b.packedAt)}` : ""}
                </>
              }
              code={b.containerNumber}
            />
          ))}
        </PlainList>
      )}
    </div>
  );
}
