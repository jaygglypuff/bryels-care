import Link from "next/link";
import { fmtDateTime } from "@/lib/qty";
import type { AlertsCard, DatabaseCard, ErrorsCard, ImportsCard, IntegrationsCard } from "@/modules/platform";
import { Card, CardTitle, EmptyState } from "@/ui/core";
import { Chip } from "@/ui/status";

const bytes = (n: number) => (n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

/** Phase 5 diagnostics cards (US-5-13): counts, names, ages and versions only (diagnostics.no_secrets). */
export function Phase5Cards({ database, imports, alerts, errors, integrations }: { database: DatabaseCard; imports: ImportsCard; alerts: AlertsCard; errors: ErrorsCard; integrations: IntegrationsCard }) {
  const connTone = database.connections.used / Math.max(1, database.connections.max) > 0.8 ? "bad" : "ok";
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card id="database">
        <CardTitle>Database</CardTitle>
        <ul className="space-y-2 text-[13px]">
          <li className="flex flex-wrap items-center gap-2">
            <Chip tone={connTone}>Connections {database.connections.used}/{database.connections.max}</Chip>
            <span className="text-muted">PostgreSQL {database.serverVersion} · size {bytes(database.sizeBytes)} · waiting locks {database.waitingLocks}</span>
          </li>
          <li className="text-muted">Longest open transaction: {database.longestTransactionSeconds === null ? "none" : `${database.longestTransactionSeconds}s`}</li>
        </ul>
        <table className="mt-3 w-full text-[12px]">
          <thead className="text-left text-muted"><tr><th className="py-1">Largest tables</th><th className="text-right">Rows (est.)</th><th className="text-right">Size</th></tr></thead>
          <tbody>
            {database.tables.map((t) => (
              <tr key={t.name} className="border-t border-line"><td className="py-1 font-mono">{t.name}</td><td className="text-right">{t.estimatedRows.toLocaleString("en-PH")}</td><td className="text-right">{bytes(t.totalBytes)}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card id="imports">
        <CardTitle>Imports</CardTitle>
        {!imports.wizardAvailable && imports.importJobs.length === 0 ? (
          <EmptyState title="No imports yet">Import runs appear here when the import wizard (US-5-08) is in use; failed imports also show in the action centre.</EmptyState>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {imports.sources.map((s) => (
              <li key={s.label} className="flex flex-wrap items-center gap-2">
                <Chip tone={s.failed ? "bad" : "ok"}>{s.failed} failed</Chip>
                <span>{s.label}: {s.total} runs{s.lastAt ? ` · last ${fmtDateTime(s.lastAt)}` : ""}</span>
              </li>
            ))}
            {imports.importJobs.map((j) => (
              <li key={j.status} className="text-muted">Import jobs (30 days) {j.status}: {j.count}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="alerts">
        <CardTitle action={<Link href="/admin/notification-rules" className="text-[13px] text-primary-text hover:underline">{alerts.activeRules} active rules</Link>}>Alerts</CardTitle>
        <p className="mb-2 text-[13px] text-muted">Alert checks run every 5 minutes; action-centre items escalate per notification rule.</p>
        <ul className="space-y-1 text-[13px]">
          {alerts.last24h.length === 0 ? <li className="text-muted">No alerts or escalations in the last 24 hours.</li> : alerts.last24h.map((a) => <li key={a.kind}><span className="font-mono">{a.kind}</span>: {a.count} sent, {a.open} unacknowledged</li>)}
          {alerts.actionItems.map((s) => (
            <li key={s.severity}>Open action-centre items ({s.severity}): {s.open}{s.escalated ? `, ${s.escalated} escalated` : ""}</li>
          ))}
        </ul>
      </Card>

      <Card id="errors">
        <CardTitle>Errors</CardTitle>
        <ul className="space-y-1 text-[13px]">
          <li className="flex flex-wrap items-center gap-2">
            <Chip tone={errors.reporting === "disabled" ? "warn" : "ok"}>Error reporting {errors.reporting}</Chip>
            <span className="text-muted">last 24 h: {errors.deadLettered24h} dead-lettered jobs · {errors.failedEmails24h} failed emails · {errors.failedDocuments24h} failed documents · {errors.failedLabelJobs24h} failed label jobs · {errors.deniedRequests24h} denied requests</span>
          </li>
        </ul>
        {errors.recentFailures.length > 0 && (
          <ul className="mt-2 space-y-1 text-[12px]">
            {errors.recentFailures.map((f, i) => (
              <li key={i} className="break-words"><span className="font-mono">{f.jobKind}</span> {f.finishedAt ? fmtDateTime(f.finishedAt) : ""}: {f.message}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card id="integrations" className="lg:col-span-2">
        <CardTitle>Integrations</CardTitle>
        <ul className="grid gap-2 text-[13px] sm:grid-cols-2">
          {integrations.adapters.map((a) => (
            <li key={a.name} className="flex flex-wrap items-center gap-2">
              <Chip tone={a.status === "configured" ? "ok" : a.status === "setup_required" ? "warn" : "neu"}>{a.status === "configured" ? "Configured" : a.status === "setup_required" ? "Setup required" : "Not built yet"}</Chip>
              <span className="font-medium">{a.name}</span>
              <span className="text-muted">{a.detail}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
