import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listContainers } from "@/modules/inventory/containers";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, buttonClass } from "@/ui/core";
import { Chip, StatusChip } from "@/ui/status";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Boxes" };

const STATUSES = ["open", "sealed", "in_transit", "empty", "void", "shipped"];

export default async function ContainersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("inventory.container.view")) return <Forbidden what="boxes" />;
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const rows = await listContainers(ctx, { q: sp.q, status });
  const filtered = !!(sp.q || status);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Boxes"
        subtitle={`${ctx.currentSite.code} · containers with their contents, status and location; quality status always comes from the lot`}
        actions={ctx.can("inventory.container.create") ? <LinkButton href="/inventory/containers/new" variant="cta">New box</LinkButton> : undefined}
      />
      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end" role="search">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-[13px] font-medium">Box or lot number</label>
            <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="BX-00000001 or L-2610-00001" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="status" className="text-[13px] font-medium">Box status</label>
            <Select id="status" name="status" defaultValue={status ?? ""}>
              <option value="">Open, sealed, in transit</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonClass("primary")}>Apply</button>
            {filtered && <Link href="/inventory/containers" className={buttonClass("ghost")}>Clear</Link>}
          </div>
        </form>
      </Card>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No boxes match" : "No boxes at this site yet"}
            action={ctx.can("inventory.container.create") && !filtered ? <LinkButton href="/inventory/containers/new">Pack stock into a box</LinkButton> : undefined}
          >
            {filtered ? "Try another number or status." : "Pack loose stock into a box to track it by box number."}
          </EmptyState>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {rows.map((b) => (
                <li key={b.id}>
                  <Link href={`/inventory/containers/${b.id}`} className="block rounded-[12px] border border-line p-3 active:bg-surface-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono font-semibold text-primary-text">{b.containerNumber}</span>
                      <Chip>{b.status.replace("_", " ")}</Chip>
                    </div>
                    <p className="mt-1 break-words text-[13px]">{b.contents ?? "Empty"}</p>
                    <p className="mt-1 text-[12px] text-muted">{b.locationCode ?? "—"}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block" head={["Box", "Contents", "Quality", "Location", "Packed", "Box status"]}>
              {rows.map((b) => (
                <tr key={b.id} className="hover:bg-surface-2">
                  <Td><Link href={`/inventory/containers/${b.id}`} className="font-mono font-semibold text-primary-text hover:underline">{b.containerNumber}</Link><div className="text-[11px] text-muted">{b.containerKind}</div></Td>
                  <Td className="text-[12px]">{b.contents ?? <span className="text-muted">Empty</span>}</Td>
                  <Td>{(b.qualityStatuses ?? "").split(",").filter(Boolean).map((s) => <StatusChip key={s} status={s} />)}</Td>
                  <Td className="font-mono">{b.locationCode ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(b.packedAt)}</Td>
                  <Td><Chip>{b.status.replace("_", " ")}</Chip></Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
