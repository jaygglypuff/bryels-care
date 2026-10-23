import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDate } from "@/lib/qty";
import { listSuppliers } from "@/modules/masterdata";
import { Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td } from "@/ui/core";
import { SupplierStatusChip } from "@/ui/receiving";
import { Forbidden } from "../../forbidden";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; all?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("masterdata.supplier.view")) return <Forbidden what="suppliers" />;
  const sp = await searchParams;
  const rows = await listSuppliers(ctx, { q: sp.q, status: sp.status, includeInactive: sp.all === "1" });
  const filtered = !!(sp.q || sp.status || sp.all);
  const canCreate = ctx.can("masterdata.supplier.create");
  const exportQs = new URLSearchParams(Object.entries({ q: sp.q ?? "", status: sp.status ?? "" }).filter(([, v]) => v)).toString();
  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle="Organization-wide. A suspended supplier blocks receipt lines until procurement or QA resolves it."
        actions={
          <>
            {ctx.can("masterdata.supplier.export") && (
              <a href={`/api/v1/masterdata/suppliers/export${exportQs ? `?${exportQs}` : ""}`} className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:bg-surface-2">
                Export CSV
              </a>
            )}
            {canCreate && <LinkButton href="/masterdata/suppliers/new" variant="cta">New supplier</LinkButton>}
          </>
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex min-w-[180px] flex-1 flex-col gap-1 text-[13px]">
            Search
            <Input name="q" defaultValue={sp.q} placeholder="Code, name, contact, city" />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Quality status
            <Select name="status" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              <option value="approved">Approved</option>
              <option value="conditional">Conditional</option>
              <option value="new">New</option>
              <option value="suspended">Suspended</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 pb-3 text-[13px]">
            <input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} className="size-4" /> Include inactive
          </label>
          <button type="submit" className="min-h-[44px] rounded-full bg-primary px-5 text-[14px] font-medium text-white">Filter</button>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? "No suppliers match" : "No suppliers yet"}
          action={filtered ? <LinkButton href="/masterdata/suppliers" variant="secondary">Clear filters</LinkButton> : canCreate ? <LinkButton href="/masterdata/suppliers/new">Add a supplier</LinkButton> : undefined}
        >
          {filtered ? "Try another search." : "Suppliers you add here can be chosen on goods receipts."}
        </EmptyState>
      ) : (
        <>
          <ul className="flex flex-col gap-3 sm:hidden">
            {rows.map((s) => (
              <li key={s.id}>
                <Link href={`/masterdata/suppliers/${s.id}`}>
                  <Card className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <SupplierStatusChip status={s.qualityStatus} />
                    </div>
                    <p className="text-[12px] text-muted">
                      {s.code} · {s.contactName ?? "No contact"} · {s.receipts} receipt{s.receipts === 1 ? "" : "s"}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <Table className="hidden sm:block" head={["Code", "Name", "Contact", "Terms", "Lead time", "Quality", "Receipts"]}>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-surface-2">
                <Td className="font-mono text-[12px]">{s.code}</Td>
                <Td>
                  <Link href={`/masterdata/suppliers/${s.id}`} className="font-medium text-primary-text hover:underline">{s.name}</Link>
                  {!s.isActive && <span className="block text-[12px] text-muted">inactive</span>}
                </Td>
                <Td>
                  {s.contactName ?? "—"}
                  {s.phone && <span className="block text-[12px] text-muted">{s.phone}</span>}
                </Td>
                <Td>{s.paymentTermsDays != null ? `${s.paymentTermsDays} d` : "—"}</Td>
                <Td>{s.defaultLeadTimeDays != null ? `${s.defaultLeadTimeDays} d` : "—"}</Td>
                <Td><SupplierStatusChip status={s.qualityStatus} /></Td>
                <Td>
                  {s.receipts}
                  {s.lastReceiptAt && <span className="block text-[12px] text-muted">last {fmtDate(s.lastReceiptAt)}</span>}
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
