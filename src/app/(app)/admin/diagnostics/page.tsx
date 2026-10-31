import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { D, fmtDateTime } from "@/lib/qty";
import { type LedgerDifference, getReconciliationRun, listReconciliationRuns } from "@/modules/inventory";
import { JOB_STATUSES, alertsCard, databaseCard, errorsCard, importsCard, integrationsCard, jobCounts, listJobs, workerStatus } from "@/modules/platform";
import { Phase5Cards } from "./phase5-cards";
import { backupsCard, healthCard, variablesCard } from "@/modules/governance";
import { OpsCards } from "./ops-cards";
import { syncDiagnostics } from "@/lib/offline/server/conflicts"; // W4D (US-7-06): Sync card
import { SyncDiagnosticsCard } from "@/ui/sync-status-diagnostics";
import { Card, CardTitle, EmptyState, Input, PageHeader, Table, Td, buttonClass, cx } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../forbidden";
import { cancelJobAction, rebuildBalancesAction, retryJobAction, runReconciliationAction } from "./actions";
import { registerAppHooks } from "@/modules/wiring";

registerAppHooks(); // Wave 3 cross-module registrations (src/modules/wiring.ts); cheap and idempotent

export const metadata = { title: "Diagnostics" };

const JOB_TONE = { queued: "info", running: "appr", succeeded: "ok", failed: "bad", cancelled: "neu" } as const;
const RUN_TONE = { clean: "ok", differences: "bad", rebuilt: "info", failed: "bad" } as const;

type Search = { status?: string; job?: string; run?: string; ok?: string; error?: string };

/**
 * Admin diagnostics: Health, Backups, Variables (US-1-26), Worker, Jobs (US-2-03) and
 * Reconciliation (US-2-04) cards, then the cards of later phases as honest "not yet" states.
 * No secrets are shown: variables are names with present/missing only.
 */
export default async function DiagnosticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  if (!ctx.can("platform.job.view") && !ctx.can("platform.diagnostics.view")) return <Forbidden what="diagnostics" />;
  const sp = await searchParams;
  const canJobs = ctx.can("platform.job.view");
  const canAdmin = ctx.can("platform.job.admin");
  const canBalanceAdmin = ctx.can("inventory.balance.admin");
  const status = sp.status && (JOB_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined;
  const canDiag = ctx.can("platform.diagnostics.view");
  const [ops, worker, counts, jobs, runs] = await Promise.all([
    canDiag ? Promise.all([healthCard(ctx), backupsCard(ctx), variablesCard(ctx)]) : null,
    workerStatus(ctx),
    canJobs ? jobCounts(ctx) : null,
    canJobs ? listJobs(ctx, { status, limit: 50 }) : [],
    canJobs || canBalanceAdmin ? listReconciliationRuns(ctx, 15) : [],
  ]);
  const phase5 = canDiag ? { database: await databaseCard(ctx), imports: await importsCard(ctx), alerts: await alertsCard(ctx), errors: await errorsCard(ctx), integrations: integrationsCard(ctx) } : null;
  const focusRunId = sp.run ?? runs.find((r) => r.status === "differences")?.id;
  const focusRun = focusRunId ? await getReconciliationRun(ctx, focusRunId).catch(() => null) : null;
  const diffs = focusRun && focusRun.kind === "inventory_balances" ? (focusRun.report as LedgerDifference[]) : [];

  return (
    <div className="space-y-5">
      <PageHeader title="Health of the system" />
      <PageIntro>This screen is for the IT person: whether the background worker runs, jobs that failed, backups, and the nightly check that stock totals match every stock movement. Nobody else needs it. Secrets are never shown.</PageIntro>
      {sp.ok && <Banner tone="ok" title={sp.ok} />}
      {sp.error && <Banner tone="bad" title="Not done">{sp.error}</Banner>}
      {ops && <OpsCards health={ops[0]} backups={ops[1]} variables={ops[2]} />}

      <Card id="worker">
        <CardTitle>Worker</CardTitle>
        {worker.workers.length === 0 ? (
          <Banner tone="warn" title="The worker is not running">
            Queued jobs (reconciliation, rebuilds) wait until the worker service starts. On Railway, check the <span className="font-mono">worker</span> service (start command <span className="font-mono">pnpm worker</span>).
          </Banner>
        ) : (
          <ul className="space-y-2 text-[13px]">
            {worker.workers.map((w) => (
              <li key={w.workerId} className="flex flex-wrap items-center gap-2">
                <Chip tone={w.alive ? "ok" : "bad"}>{w.alive ? "Alive" : "Silent"}</Chip>
                <span className="font-mono">{w.hostname}</span>
                <span className="text-muted">last heartbeat {w.ageSeconds}s ago · started {fmtDateTime(w.startedAt)}{w.releaseTag ? ` · release ${w.releaseTag}` : ""} · queue {w.queueDepth ?? "?"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canJobs && counts && (
        <Card id="jobs">
          <CardTitle>Jobs</CardTitle>
          <nav aria-label="Job status" className="mb-3 flex flex-wrap gap-2">
            <Link href="/admin/diagnostics#jobs" aria-current={!status ? "page" : undefined} className={cx("rounded-full border px-3 py-1 text-[13px]", !status ? "border-primary bg-primary-soft font-semibold" : "border-line")}>All</Link>
            {JOB_STATUSES.map((s) => (
              <Link key={s} href={`/admin/diagnostics?status=${s}#jobs`} aria-current={status === s ? "page" : undefined} className={cx("rounded-full border px-3 py-1 text-[13px]", status === s ? "border-primary bg-primary-soft font-semibold" : "border-line")}>
                {s} · {counts[s]}
              </Link>
            ))}
          </nav>
          {jobs.length === 0 ? (
            <EmptyState title={status ? `No ${status} jobs` : "No jobs yet"}>Jobs appear here when the nightly reconciliation runs or someone requests a rebuild.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {jobs.map((j) => (
                <li key={j.id} id={`job-${j.id}`} className={cx("py-3", sp.job === j.id && "rounded-[12px] bg-[var(--warn-bg)]/40 px-2")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={JOB_TONE[j.status as keyof typeof JOB_TONE] ?? "neu"}>{j.status}</Chip>
                    {j.deadLetteredAt && <Chip tone="bad">dead-lettered</Chip>}
                    <span className="font-medium">{j.title}</span>
                    <span className="font-mono text-[12px] text-muted">{j.jobKind}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">
                    Created {fmtDateTime(j.createdAt)} · attempts {j.attempts}/{j.maxAttempts}
                    {j.retriedCount ? ` · retried ${j.retriedCount}×` : ""} · correlation <span className="font-mono">{j.correlationId.slice(0, 13)}</span>
                    {j.finishedAt ? ` · finished ${fmtDateTime(j.finishedAt)}` : ""}
                  </p>
                  {j.errorMessage && <p className="mt-1 break-words text-[13px] text-[var(--bad-fg)]">Last error: {j.errorMessage}</p>}
                  <details className="mt-1 text-[12px]">
                    <summary className="cursor-pointer text-muted">Payload summary</summary>
                    <pre className="mt-1 max-w-full overflow-x-auto rounded-[10px] bg-surface-2 p-2">{JSON.stringify(j.payloadSummary, null, 2)}</pre>
                  </details>
                  {canAdmin && (j.status === "failed" || j.status === "cancelled" || j.status === "queued") && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <form action={retryJobAction} className="flex flex-wrap gap-2">
                          <input type="hidden" name="jobId" value={j.id} />
                          <Input name="reason" placeholder="Reason (optional)" className="!min-h-[34px] w-48 text-[13px]" aria-label="Reason for retry" />
                          <button className={buttonClass("secondary", "sm")}>Retry</button>
                        </form>
                      )}
                      {(j.status === "queued" || j.status === "failed") && (
                        <form action={cancelJobAction}>
                          <input type="hidden" name="jobId" value={j.id} />
                          <button className={buttonClass("ghost", "sm")}>Cancel</button>
                        </form>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {(canJobs || canBalanceAdmin) && (
        <Card id="reconciliation">
          <CardTitle
            action={
              canBalanceAdmin ? (
                <form action={runReconciliationAction}>
                  <button className={buttonClass("secondary", "sm")}>Run now for {ctx.currentSite.code}</button>
                </form>
              ) : undefined
            }
          >
            Stock reconciliation
          </CardTitle>
          <p className="mb-3 text-[13px] text-muted">Every night at 01:00 the ledger is compared with the balance table. Differences are reported, never corrected automatically (runbook §9).</p>
          {runs.length === 0 ? (
            <EmptyState title="No reconciliation has run yet">The first nightly run appears here once the worker is running.</EmptyState>
          ) : (
            <Table head={["When", "Kind", "Scope", "Result", "Keys", ""]}>
              {runs.map((r) => (
                <tr key={r.id} className={cx(r.id === focusRun?.id && "bg-surface-2")}>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                  <Td>{r.kind === "rebuild" ? "Rebuild" : "Reconciliation"}</Td>
                  <Td>{r.siteId ? (ctx.allowedSites.find((s) => s.id === r.siteId)?.code ?? "site") : "All sites"}</Td>
                  <Td><Chip tone={RUN_TONE[r.status as keyof typeof RUN_TONE] ?? "neu"}>{r.status}</Chip></Td>
                  <Td className="text-right">{r.differencesCount}</Td>
                  <Td>{r.differencesCount > 0 && <Link className="text-primary-text hover:underline" href={`/admin/diagnostics?run=${r.id}#reconciliation`}>Report</Link>}</Td>
                </tr>
              ))}
            </Table>
          )}
          {focusRun && focusRun.differencesCount > 0 && (
            <div className="mt-4 space-y-3">
              <h3 className="font-semibold">{focusRun.kind === "rebuild" ? "Rebuilt keys" : "Differences"} · {fmtDateTime(focusRun.createdAt)}</h3>
              {focusRun.kind === "rebuild" ? (
                <Table head={["Lot", "Location", "Before", "After"]}>
                  {(focusRun.report as { lotId: string; locationId: string; lotNumber: string; locationCode: string; before: string; after: string }[]).map((c) => (
                    <tr key={`${c.lotId}:${c.locationId}`}>
                      <Td className="font-mono">{c.lotNumber}</Td>
                      <Td className="font-mono">{c.locationCode}</Td>
                      <Td className="text-right">{c.before}</Td>
                      <Td className="text-right">{c.after}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <>
                  <Table head={["Lot", "Location", "Ledger", "Balance table", "Difference"]}>
                    {diffs.map((d) => (
                      <tr key={`${d.lotId}:${d.locationId}`}>
                        <Td><Link className="font-mono text-primary-text hover:underline" href={`/inventory/stock-card/${d.lotId}`}>{d.lotNumber}</Link></Td>
                        <Td className="font-mono">{d.locationCode}</Td>
                        <Td className="text-right">{d.ledgerQty}</Td>
                        <Td className="text-right">{d.projectedQty}</Td>
                        <Td className="text-right font-semibold">{D(d.projectedQty).minus(d.ledgerQty).toString()}</Td>
                      </tr>
                    ))}
                  </Table>
                  {canBalanceAdmin && diffs.some((d) => d.siteId === ctx.currentSiteId) && (
                    <form action={rebuildBalancesAction} className="flex flex-wrap items-end gap-2 rounded-[14px] border border-line p-3">
                      <input type="hidden" name="runId" value={focusRun.id} />
                      <label className="min-w-[240px] flex-1 text-[13px]">
                        Rebuild the {ctx.currentSite.code} balances of these lots from the ledger. Reason (required)
                        <Input name="reason" required minLength={3} maxLength={500} placeholder="Confirmed projection fault, see ticket" />
                      </label>
                      <button className={buttonClass("danger", "sm")}>Queue rebuild</button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </Card>
      )}
      {phase5 && <Phase5Cards {...phase5} />}
      {canDiag && <SyncDiagnosticsCard d={await syncDiagnostics(ctx)} />}
    </div>
  );
}
