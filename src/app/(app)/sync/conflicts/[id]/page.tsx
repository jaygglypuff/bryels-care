import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { getConflict } from "@/lib/offline/server/conflicts";
import { REASON_LABEL, commandLabel, type SyncConflictReason } from "@/lib/offline/protocol";
import { fmtDateTime } from "@/lib/qty";
import { reasonCodeOptions } from "@/modules/masterdata";
import { Card, CardTitle, Dl, LinkButton, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { ResolveForms } from "./resolve-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sync conflict" };

const FIELD_LABEL: Record<string, string> = {
  qty: "Quantity",
  note: "Note",
  reason: "Reason",
  lotRef: "Lot scanned",
  locationRef: "Location scanned",
  equipmentRef: "Scale",
  unlabelledDescription: "Unlabelled item",
  uom: "Unit",
  partial: "Another lot follows",
  lotId: "Lot (id)",
  locationId: "Location (id)",
  fromLocationId: "From location (id)",
  toLocationId: "To location (id)",
  countId: "Count (id)",
  batchId: "Batch (id)",
  batchMaterialId: "Ingredient line (id)",
};
const SERVER_LABEL: Record<string, string> = {
  qualityStatus: "Lot status",
  expiresOn: "Expires",
  onHandAtSource: "On hand at the source",
  baseUom: "Unit",
  status: "Status",
  isBlind: "Blind count",
  line: "Ingredient line",
  deviationId: "Deviation (id)",
  deviationNumber: "Deviation",
};
/** Fields a reviewer may correct before re-applying (identifiers stay as captured). */
const EDITABLE = ["qty", "note", "reason", "lotRef", "locationRef", "equipmentRef", "unlabelledDescription", "uom"];

const HREF: Record<string, (id: string) => string> = {
  stock_count: (id) => `/inventory/counts/${id}`,
  batch: (id) => `/production/${id}`,
  inventory_lot: (id) => `/inventory/lots/${id}`,
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** US-7-05: one conflict with the device's version, the server's version and the resolution choices. */
export default async function ConflictPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  let c;
  try {
    c = await getConflict(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const payload = (c.command.payload ?? {}) as Record<string, unknown>;
  const server = (c.serverState ?? {}) as Record<string, unknown>;
  const editable = Object.entries(payload).filter(([k, v]) => EDITABLE.includes(k) && typeof v === "string").map(([k, v]) => ({ key: k, label: FIELD_LABEL[k] ?? k, value: String(v) }));
  const canEscalateAdjustment = c.commandType.startsWith("inventory.") && typeof payload.lotId === "string" && (typeof payload.locationId === "string" || typeof payload.fromLocationId === "string");
  const canEscalateDeviation = c.commandType.startsWith("production.") || typeof server.deviationId === "string" || c.relatedEntityType === "batch" || c.relatedEntityType === "inventory_lot";
  const reasonCodes = c.canResolve && canEscalateAdjustment ? await reasonCodeOptions(db, ctx.organizationId, "adjustment") : [];
  const href = c.relatedEntityType && c.relatedEntityId && HREF[c.relatedEntityType] ? HREF[c.relatedEntityType](c.relatedEntityId) : null;

  return (
    <>
      <PageHeader
        title={`${commandLabel(c.commandType)}${c.relatedEntityNumber ? ` · ${c.relatedEntityNumber}` : ""}`}
        subtitle={`Captured offline by ${c.userName}${c.deviceLabel ? ` on ${c.deviceLabel}` : ""} at ${fmtDateTime(c.command.clientCreatedAt)}; received ${fmtDateTime(c.command.receivedAt)} · site ${c.siteCode}`}
        actions={<LinkButton href={ctx.can("platform.sync_conflict.view") ? "/sync/conflicts" : "/sync"} variant="secondary">Back</LinkButton>}
      />
      <div className="space-y-5">
        <Banner tone={c.status === "open" ? "warn" : "info"} title={`${REASON_LABEL[c.reasonCode as SyncConflictReason] ?? c.reasonCode}${c.status === "open" ? " · waiting for review" : ` · ${c.status.replace(/_/g, " ")}`}`}>
          {c.reasonMessage} Nothing from this change was applied{c.status === "resolved_applied" || c.status === "resolved_amended" ? " until a reviewer re-applied it as a new change" : ""}.
        </Banner>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle>On the device (as sent)</CardTitle>
            <Dl items={Object.entries(payload).map(([k, v]) => [FIELD_LABEL[k] ?? k, show(v)])} />
            {c.command.isClockSkewFlagged && <p className="mt-3 text-[12px] text-[var(--warn-fg)]">The device clock differed from the server by {Math.round(c.command.clockSkewSeconds / 60)} min.</p>}
          </Card>
          <Card>
            <CardTitle action={href ? <Link href={href} className="text-[13px] font-medium text-primary-text hover:underline">Open record</Link> : undefined}>On the server now</CardTitle>
            {Object.keys(server).length === 0 ? <p className="text-[13px] text-muted">No related record to show.</p> : <Dl items={Object.entries(server).filter(([k]) => k !== "deviationId").map(([k, v]) => [SERVER_LABEL[k] ?? k, show(v)])} />}
            {typeof server.deviationNumber === "string" && <p className="mt-3 text-[13px]">A deviation stub was opened for QA: <Chip tone="warn">{server.deviationNumber}</Chip></p>}
          </Card>
        </div>

        {c.status !== "open" && (
          <Card>
            <CardTitle>Resolution</CardTitle>
            <Dl
              items={[
                ["Decision", c.status.replace(/_/g, " ")],
                ["By", c.resolvedByName ?? "—"],
                ["When", fmtDateTime(c.resolvedAt)],
                ["Note", c.resolutionNote ?? "—"],
                ["New change", c.resolution ? `${c.resolution.status}${c.resolution.appliedEntityNumber ? ` · ${c.resolution.appliedEntityNumber}` : ""}` : "—"],
                ["Escalated to", c.escalatedEntityType ? `${c.escalatedEntityType.replace("_", " ")}` : "—"],
              ]}
            />
          </Card>
        )}

        {c.attempts.length > 0 && (
          <Card>
            <CardTitle>Re-apply attempts</CardTitle>
            <ul className="divide-y divide-line text-[13px]">
              {c.attempts.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{fmtDateTime(a.receivedAt)}</span>
                  <span className="min-w-0 break-words text-muted">{a.status === "applied" ? "Applied" : `Not accepted: ${a.errorMessage ?? ""}`}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {c.status === "open" && (c.canResolve || c.canDiscardOwn) && (
          <ResolveForms conflictId={c.id} editable={editable} ownDiscardOnly={!c.canResolve} canEscalateAdjustment={c.canResolve && canEscalateAdjustment} canEscalateDeviation={c.canResolve && canEscalateDeviation} reasonCodes={reasonCodes} />
        )}
        {c.status === "open" && !c.canResolve && !c.canDiscardOwn && (
          <Card>
            <p className="text-[13px] text-muted">{c.isOwn ? "A supervisor at this site reviews your change. You will see the decision here." : "Resolving needs the sync conflict approval permission at this site."}</p>
          </Card>
        )}
      </div>
    </>
  );
}
