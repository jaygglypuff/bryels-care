import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime, fmtMoney } from "@/lib/qty";
import { listAdjustments } from "@/modules/inventory/adjustments";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { AdjustmentStatusChip } from "../counts/status";
import { adjustmentReasonWords } from "./reason-words";

export const metadata = { title: "Fix stock" };

export default async function AdjustmentsPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.view")) return <Forbidden what="stock adjustments" />;
  const rows = await listAdjustments(ctx);
  const waiting = rows.filter((r) => r.status === "submitted").length;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Fix stock"
        subtitle={`${ctx.currentSite.code} · found, missing or damaged stock: you send it, a manager approves it, then it is saved; nothing changes before approval`}
        actions={ctx.can("inventory.adjustment.create") ? <LinkButton href="/inventory/adjustments/new" variant="cta">Fix stock</LinkButton> : undefined}
      />
      {waiting > 0 && ctx.can("inventory.adjustment.approve") && <p className="text-[13px] font-medium">{waiting} waiting for your approval.</p>}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing fixed yet">Stock fixes made at this site appear here with where they are.</EmptyState>
        ) : (
          <>
            <ul className="space-y-2 sm:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/inventory/adjustments/${a.id}`} className="block rounded-[12px] border border-line p-3">
                    <div className="flex items-start justify-between gap-2"><span className="font-mono font-semibold text-primary-text">{a.number}</span><AdjustmentStatusChip status={a.status} /></div>
                    <p className="mt-1 text-[13px]">{adjustmentReasonWords(a.reasonCode)} · {a.lines} {a.lines === 1 ? "lot" : "lots"} · {a.createdBy}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block" head={["Number", "What happened", "Lots", "Value", "Made", "Where it is"]}>
              {rows.map((a) => (
                <tr key={a.id}>
                  <Td><Link href={`/inventory/adjustments/${a.id}`} className="font-mono font-semibold text-primary-text hover:underline">{a.number}</Link></Td>
                  <Td>{adjustmentReasonWords(a.reasonCode)}</Td>
                  <Td>{a.lines}</Td>
                  <Td>{a.totalValueAmount === null ? "—" : `${fmtMoney(a.totalValueAmount)}${a.valueUnknown ? " +unknown" : ""}`}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(a.createdAt)} · {a.createdBy}</Td>
                  <Td><AdjustmentStatusChip status={a.status} />{a.requiresSecondApproval && a.status === "submitted" ? <> <Chip tone="warn">2 approvals</Chip></> : null}</Td>
                </tr>
              ))}
            </Table>
          </>
        )}
      </Card>
    </div>
  );
}
