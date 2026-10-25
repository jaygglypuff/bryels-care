import { LEGAL_HOLD_ENTITY_TYPES, LEGAL_HOLD_KINDS, RETENTION_ACTIONS, RETENTION_BASES } from "@/db/schema";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { ENTITY_LABELS, listLegalHolds, listPurgeRuns, listRestoreDrills, listRetentionPolicies, periodLabel } from "@/modules/platform";
import { Card, CardTitle, EmptyState, PageHeader, Table, Td } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { StepUpGate } from "../users/step-up-gate";
import { DryRunForm, ExecutePurgeForm, PlaceHoldForm, PolicyConfirmForm, PolicyEditForm, ReleaseHoldForm, SignOffDrillForm } from "./forms";

export const metadata = { title: "Retention and legal holds" };

const OUTCOME: Record<string, { tone: "ok" | "warn" | "bad" | "info" | "neu" | "hold"; label: string }> = {
  deleted: { tone: "ok", label: "deleted" },
  would_delete: { tone: "warn", label: "would delete" },
  report_only_unconfirmed: { tone: "neu", label: "unconfirmed: report only" },
  archive_report: { tone: "info", label: "archive candidates (report)" },
  anonymise_report: { tone: "info", label: "anonymise candidates (report)" },
  keep: { tone: "neu", label: "kept" },
  protected: { tone: "bad", label: "protected: never deleted" },
  handled_elsewhere: { tone: "neu", label: "handled by another job" },
  not_in_this_release: { tone: "neu", label: "not in this release" },
};

const dur = (s: number | null) => (s === null ? "–" : s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

/**
 * Retention, legal holds, purge runs and restore drills (US-9-05, US-9-03). Periods are configuration
 * confirmed by the company's qualified reviewers; the sweep only reports for unconfirmed classes.
 */
export default async function RetentionPage() {
  const ctx = await requireContext();
  const canPolicies = ctx.can("platform.retention_policy.view");
  const canHolds = ctx.can("platform.legal_hold.view");
  const canRuns = ctx.can("platform.purge_run.view");
  const canDrills = ctx.can("platform.restore_drill.view");
  if (!canPolicies && !canHolds && !canRuns && !canDrills) return <Forbidden what="retention policies and legal holds" />;
  const [policies, holds, runs, drills] = await Promise.all([
    canPolicies ? listRetentionPolicies(ctx) : Promise.resolve(null),
    canHolds ? listLegalHolds(ctx) : Promise.resolve(null),
    canRuns ? listPurgeRuns(ctx, 10) : Promise.resolve(null),
    canDrills ? listRestoreDrills(ctx, 10) : Promise.resolve(null),
  ]);
  const canEdit = ctx.can("platform.retention_policy.edit");
  const canConfirm = ctx.can("platform.retention_policy.approve");
  const canPlace = ctx.can("platform.legal_hold.create");
  const canRelease = ctx.can("platform.legal_hold.void");
  const canDryRun = ctx.can("platform.purge_run.create");
  const canPurge = ctx.can("platform.purge_run.post");
  const canSignOff = ctx.can("platform.restore_drill.approve");
  const today = new Date().toISOString().slice(0, 10);
  const restricted = canEdit || canConfirm || canPurge || canSignOff;
  const latestRun = runs?.[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader title="Retention and legal holds" subtitle="How long records are kept, what is held, what the weekly sweep did, and the restore drill evidence." />
      {restricted && <StepUpGate ctx={ctx} purpose="change retention, run a purge or sign off a drill" />}
      <Banner tone="info" title="Placeholders until the company's reviewers confirm them">
        The periods are engineering defaults from the data model, not legal advice. A class acts only after its confirmation is recorded; ledgers, quality records, finance, payroll and audit are never deleted by the sweep.
      </Banner>

      {policies && (
        <Card>
          <CardTitle>Retention policies</CardTitle>
          <Table head={["Class", "Applies to", "Period", "Counts from", "At the end", "Status"]}>
            {policies.map((p) => (
              <tr key={`${p.dataClass}/${p.target}`} className="align-top">
                <Td>
                  <div className="font-mono text-[12px]">{p.dataClass}</div>
                  <div className="text-[12px] text-muted">{p.description}</div>
                  {(canEdit || (canConfirm && !p.isConfirmed)) && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[13px] text-primary-text">{canEdit ? "Change or confirm" : "Confirm"}</summary>
                      {canEdit && (
                        <PolicyEditForm
                          dataClass={p.dataClass}
                          target={p.target}
                          unit={p.retentionMonths ? "months" : p.retentionDays ? "days" : "none"}
                          value={p.retentionMonths ?? p.retentionDays}
                          basis={p.basis}
                          minimumMonths={p.minimumMonths}
                          action={p.action}
                          actions={p.protected ? ["archive", "keep"] : RETENTION_ACTIONS}
                          bases={RETENTION_BASES}
                          today={today}
                        />
                      )}
                      {canConfirm && !p.isConfirmed && <PolicyConfirmForm dataClass={p.dataClass} target={p.target} />}
                    </details>
                  )}
                </Td>
                <Td className="font-mono text-[12px]">{p.target === "*" ? "whole class" : p.target}</Td>
                <Td>{periodLabel(p)}</Td>
                <Td>{p.basis.replace(/_/g, " ")}</Td>
                <Td>
                  {p.action}
                  {p.protected && (
                    <div className="mt-1">
                      <Chip tone="hold">protected</Chip>
                    </div>
                  )}
                </Td>
                <Td>
                  {p.isConfirmed ? (
                    <>
                      <Chip tone="ok">confirmed</Chip>
                      <div className="text-[12px] text-muted">
                        {p.confirmedByName} · {fmtDateTime(p.confirmedAt)}
                      </div>
                      {p.confirmationNote && <div className="text-[12px] text-muted">“{p.confirmationNote}”</div>}
                    </>
                  ) : (
                    <Chip tone="warn">{p.source === "default" ? "default, unconfirmed" : "unconfirmed"}</Chip>
                  )}
                  {p.assumptionId && <div className="text-[11px] text-muted">{p.assumptionId}</div>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {holds && (
        <Card>
          <CardTitle>Legal holds</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            A hold stops every retention action on the record. A held lot also holds the batch that made it; a held batch holds its output lots. Open complaints and open deviations hold their lots and batches automatically.
          </p>
          {holds.length === 0 ? (
            <EmptyState title="No active legal holds">Place one when a claim, recall, audit or regulator query needs records kept.</EmptyState>
          ) : (
            <Table head={["Record", "Kind", "Reason", "Placed", ""]}>
              {holds.map((h) => (
                <tr key={h.id} className="align-top">
                  <Td>
                    <div className="text-[12px] text-muted">{ENTITY_LABELS[h.entityType as keyof typeof ENTITY_LABELS] ?? h.entityType}</div>
                    <div className="font-mono">{h.entityLabel}</div>
                  </Td>
                  <Td>{h.holdKind}</Td>
                  <Td>{h.reason}</Td>
                  <Td>
                    {h.placedByName}
                    <div className="text-[12px] text-muted">{fmtDateTime(h.placedAt)}</div>
                  </Td>
                  <Td>{canRelease && h.placedBy !== ctx.userId ? <ReleaseHoldForm id={h.id} /> : canRelease ? <span className="text-[12px] text-muted">You placed it; another person releases it.</span> : null}</Td>
                </tr>
              ))}
            </Table>
          )}
          {canPlace && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] text-primary-text">Place a legal hold</summary>
              <div className="mt-2">
                <PlaceHoldForm kinds={LEGAL_HOLD_KINDS} entityTypes={LEGAL_HOLD_ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_LABELS[t] }))} />
              </div>
            </details>
          )}
        </Card>
      )}

      {runs && (
        <Card>
          <CardTitle action={canDryRun ? <DryRunForm /> : undefined}>Retention sweep</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            The weekly sweep (Sunday 03:00 Manila) writes a dry-run report unless the setting “Weekly retention sweep” is set to execute. A dry run never deletes anything.
          </p>
          {runs.length === 0 ? (
            <EmptyState title="No sweep has run yet">Run a dry run to see what is past its period and what is held.</EmptyState>
          ) : (
            <Table head={["When", "Mode", "Past period", "Held", "Deleted", "By"]}>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td>{fmtDateTime(r.startedAt)}</Td>
                  <Td>
                    <Chip tone={r.status === "failed" ? "bad" : r.mode === "execute" ? "warn" : "neu"}>{r.status === "failed" ? "failed" : r.mode === "execute" ? "execution" : "dry run"}</Chip>
                    {r.trigger === "scheduled" && <span className="ml-1 text-[12px] text-muted">weekly</span>}
                  </Td>
                  <Td>{r.candidateRows}</Td>
                  <Td>{r.heldRows}</Td>
                  <Td>{r.deletedRows}</Td>
                  <Td>{r.requestedByName ?? "System"}</Td>
                </tr>
              ))}
            </Table>
          )}
          {latestRun && latestRun.targets.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] text-primary-text">Report of the latest run ({fmtDateTime(latestRun.startedAt)})</summary>
              <Table head={["Target", "Outcome", "Past period", "Held", "Deleted", "Note"]}>
                {latestRun.targets.map((t) => (
                  <tr key={t.key} className="align-top">
                    <Td className="font-mono text-[12px]">{t.key}</Td>
                    <Td>
                      <Chip tone={OUTCOME[t.outcome]?.tone ?? "neu"}>{OUTCOME[t.outcome]?.label ?? t.outcome}</Chip>
                    </Td>
                    <Td>{t.candidates ?? "–"}</Td>
                    <Td>{t.held ?? "–"}</Td>
                    <Td>{t.deleted}</Td>
                    <Td className="text-[12px] text-muted">{t.note}</Td>
                  </tr>
                ))}
              </Table>
            </details>
          )}
          {canPurge && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] text-primary-text">Run a purge now</summary>
              <div className="mt-2">
                <ExecutePurgeForm />
              </div>
            </details>
          )}
        </Card>
      )}

      {drills && (
        <Card>
          <CardTitle>Restore drills</CardTitle>
          <p className="mb-3 text-[13px] text-muted">
            Recorded by the drill script (<span className="font-mono">pnpm restore:drill</span>, runbook §13.6). Targets: restore within 4 hours (RTO), from a dump at most 24 hours old (RPO), until the owner confirms other values.
          </p>
          {drills.length === 0 ? (
            <EmptyState title="No restore drill recorded yet">The first drill is required before go-live (Gate 9), then every quarter.</EmptyState>
          ) : (
            <Table head={["When", "Result", "Restore time", "Dump age", "Checks", "Sign-off"]}>
              {drills.map((d) => (
                <tr key={d.id} className="align-top">
                  <Td>
                    {fmtDateTime(d.performedAt)}
                    <div className="text-[12px] text-muted">
                      {d.performedByName} · {d.targetEnvironment}
                    </div>
                  </Td>
                  <Td>
                    <Chip tone={d.result === "passed" ? "ok" : "bad"}>{d.result}</Chip>
                  </Td>
                  <Td>{dur(d.measuredRtoSeconds)}</Td>
                  <Td>{dur(d.dumpAgeSeconds)}</Td>
                  <Td className="text-[12px]">
                    checksum {d.checksumVerified ? "ok" : "failed"} · decrypt {d.decryptSucceeded ? "ok" : "failed"} · row counts {d.rowCountsMatch === null ? "–" : d.rowCountsMatch ? "match" : "differ"} · migrations {d.migrationsCurrent === null ? "–" : d.migrationsCurrent ? "current" : "behind"} · reconciliation {d.reconciliationRows ?? "–"}
                  </Td>
                  <Td>
                    {d.signedOffBy ? (
                      <>
                        {d.signedOffByName}
                        <div className="text-[12px] text-muted">{fmtDateTime(d.signedOffAt)}</div>
                      </>
                    ) : canSignOff && d.performedBy !== ctx.userId ? (
                      <SignOffDrillForm id={d.id} />
                    ) : (
                      <span className="text-[12px] text-muted">Waiting for the owner</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
