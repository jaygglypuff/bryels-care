import { requireContext } from "@/lib/auth/context";
import { numberingBusinessDate } from "@/lib/numbering";
import { fmtDateTime } from "@/lib/qty";
import { listNumberingAdmin } from "@/modules/governance";
import { Card, CardTitle, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { NumberingVersionForm, VersionDecision } from "./forms";

export const metadata = { title: "Numbering rules" };

const STATUS_TONE = { submitted: "appr", approved: "ok", rejected: "bad", cancelled: "neu" } as const;

/** Numbering rules (US-1-19 AC1–AC2): patterns per document type; changes are versions approved by a second administrator. */
export default async function NumberingPage() {
  const ctx = await requireContext();
  if (!ctx.can("platform.numbering_rule.view")) return <Forbidden what="numbering rules" />;
  const canAdmin = ctx.can("platform.numbering_rule.admin");
  const rows = await listNumberingAdmin(ctx);
  const today = numberingBusinessDate();
  return (
    <div className="space-y-5">
      <PageHeader title="Numbering rules" subtitle="How document numbers look. A change never alters numbers already issued; the running number of the period continues." />
      {!canAdmin && <Banner tone="info" title="Read only">System administrators change numbering; a second administrator approves each change.</Banner>}
      <Card>
        <CardTitle>Document types</CardTitle>
        <Table head={["Type", "Pattern", "Restarts", "Example", "Next (expected)", "Source"]}>
          {rows.map((r) => (
            <tr key={r.documentType}>
              <Td className="font-mono">{r.documentType}</Td>
              <Td className="font-mono">{r.rule.pattern.replace("{PREFIX}", r.rule.prefix)}</Td>
              <Td>{r.rule.resetPeriod}</Td>
              <Td className="font-mono">{r.example}</Td>
              <Td className="font-mono">{r.expectedNext ?? "gapless (not previewed)"}</Td>
              <Td>{r.rule.source === "version" ? `version ${r.rule.versionNo} from ${r.rule.effectiveFrom}` : "built-in default (A-PRD-04)"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      {rows.map((r) => (
        <Card key={r.documentType} id={`type-${r.documentType}`}>
          <CardTitle>{r.documentType}</CardTitle>
          {r.counters.length > 0 && (
            <p className="mb-2 text-[13px] text-muted">
              Counters: {r.counters.map((c) => `${c.periodKey || "all time"} → next ${c.nextValue}`).join(" · ")}
            </p>
          )}
          {r.versions.length === 0 ? (
            <p className="text-[13px] text-muted">No versions yet; the built-in default applies.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {r.versions.map((v) => (
                <li key={v.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={STATUS_TONE[v.status as keyof typeof STATUS_TONE] ?? "neu"}>{v.status}</Chip>
                    <span className="font-medium">Version {v.versionNo}</span>
                    <span className="font-mono">{v.pattern.replace("{PREFIX}", v.prefix)}</span>
                    <span className="text-muted">
                      from {v.effectiveFrom}
                      {v.effectiveTo ? ` until ${v.effectiveTo}` : ""}
                    </span>
                  </div>
                  <p className="text-muted">
                    {v.submitterName} · {fmtDateTime(v.submittedAt)} · “{v.changeSummary}”{v.rejectionReason ? ` · closed: ${v.rejectionReason}` : ""}
                  </p>
                  {canAdmin && v.status === "submitted" && <VersionDecision id={v.id} isOwn={v.submittedBy === ctx.userId} />}
                </li>
              ))}
            </ul>
          )}
          {canAdmin && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-primary-text">Propose a new version</summary>
              <NumberingVersionForm documentType={r.documentType} current={r.rule} today={today} />
            </details>
          )}
        </Card>
      ))}
    </div>
  );
}
