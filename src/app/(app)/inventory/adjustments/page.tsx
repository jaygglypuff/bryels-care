import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime, fmtMoney } from "@/lib/qty";
import { listAdjustments } from "@/modules/inventory/adjustments";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { ADJ_STATUS_TONE } from "../counts/status";

export const metadata = { title: "Stock adjustments" };

export default async function AdjustmentsPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.view")) return <Forbidden what="stock adjustments" />;
  const rows = await listAdjustments(ctx);
  const waiting = rows.filter((r) => r.status === "submitted").length;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock adjustments"
        subtitle={`${ctx.currentSite.code} · found, lost or damaged stock is drafted, approved by a second person and then posted; nothing changes stock before approval`}
        actions={ctx.can("inventory.adjustment.create") ? <LinkButton href="/inventory/adjustments/new" variant="cta">New adjustment</LinkButton> : undefined}
      />
      {waiting > 0 && ctx.can("inventory.adjustment.approve") && <p className="text-[13px] font-medium">{waiting} adjustment(s) waiting for approval.</p>}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No adjustments yet">Adjustments drafted at this site appear here with their approval status.</EmptyState>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/inventory/adjustments/${a.id}`} className="block rounded-[12px] border border-line p-3">
                    <div className="flex items-start justify-between gap-2"><span className="font-mono font-semibold text-primary-text">{a.number}</span><Chip tone={ADJ_STATUS_TONE[a.status]}>{a.status}</Chip></div>
                    <p className="mt-1 text-[13px]">{a.reasonCode.replace(/_/g, " ")} · {a.lines} line(s) · {a.createdBy}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block" head={["Number", "Reason", "Lines", "Value", "Drafted", "Status"]}>
              {rows.map((a) => (
                <tr key={a.id}>
                  <Td><Link href={`/inventory/adjustments/${a.id}`} className="font-mono font-semibold text-primary-text hover:underline">{a.number}</Link></Td>
                  <Td>{a.reasonCode.replace(/_/g, " ")}</Td>
                  <Td>{a.lines}</Td>
                  <Td>{a.totalValueAmount === null ? "—" : `${fmtMoney(a.totalValueAmount)}${a.valueUnknown ? " +unknown" : ""}`}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(a.createdAt)} · {a.createdBy}</Td>
                  <Td><Chip tone={ADJ_STATUS_TONE[a.status]}>{a.status}</Chip>{a.requiresSecondApproval && a.status === "submitted" ? <> <Chip tone="warn">2 approvals</Chip></> : null}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
