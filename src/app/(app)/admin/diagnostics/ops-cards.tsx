import { fmtDateTime } from "@/lib/qty";
import type { BackupsCard, HealthCard, VariablesCard } from "@/modules/governance";
import { Card, CardTitle, EmptyState } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";

const dur = (s: number) => (s < 120 ? `${s}s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172_800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86_400)} d`);

/** Health, Backups and Variables (US-1-26 AC1): booleans, ages, names and versions only. */
export function OpsCards({ health, backups, variables }: { health: HealthCard; backups: BackupsCard; variables: VariablesCard }) {
  return (
    <>
      <Card id="health">
        <CardTitle>Health</CardTitle>
        {health.readOnlyMode && <Banner tone="warn" title="Read-only maintenance mode is on">Only allow-listed roles can change data. Turn it off in Settings → Maintenance.</Banner>}
        <ul className="space-y-2 text-[13px]">
          <li className="flex flex-wrap items-center gap-2">
            <Chip tone={health.web.ready ? "ok" : "bad"}>{health.web.ready ? "Web ready" : "Web not ready"}</Chip>
            <span className="text-muted">
              database {health.web.database}
              {health.web.databaseLatencyMs !== null ? ` (${health.web.databaseLatencyMs} ms)` : ""} · release <span className="font-mono">{health.web.release}</span> · {health.web.appEnv} · up {dur(health.web.uptimeSeconds)}
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <Chip tone={health.migrations.current === null ? "warn" : health.migrations.current ? "ok" : "bad"}>
              {health.migrations.current === null ? "Migrations unknown" : health.migrations.current ? "Migrations current" : "Migrations behind"}
            </Chip>
            <span className="text-muted">
              applied {health.migrations.applied ?? "?"} of {health.migrations.bundled ?? "?"} bundled
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <Chip tone={health.worker.alive ? "ok" : "bad"}>{health.worker.alive ? "Worker alive" : health.worker.present ? "Worker silent" : "No worker yet"}</Chip>
            <span className="text-muted">
              {health.worker.heartbeatAgeSeconds !== null ? `last heartbeat ${dur(health.worker.heartbeatAgeSeconds)} ago` : "no heartbeat recorded"} · queue {health.queue === "ok" ? "reachable" : "not started"}
              {health.worker.release ? ` · release ${health.worker.release}` : ""}
            </span>
          </li>
        </ul>
      </Card>

      <Card id="backups">
        <CardTitle>Backups</CardTitle>
        {!backups.configured ? (
          <EmptyState title="Backup status is not configured">
            This deployment does not report backups yet{backups.source ? ` (unknown source “${backups.source}”)` : ""}. Set <span className="font-mono">BACKUP_STATUS_SOURCE=table</span> once the backup service records its runs (runbook §13). Nothing here means a backup exists.
          </EmptyState>
        ) : (
          <ul className="space-y-2 text-[13px]">
            <li className="flex flex-wrap items-center gap-2">
              <Chip tone={backups.lastSuccess && !backups.overdue ? "ok" : "bad"}>{backups.lastSuccess ? (backups.overdue ? "Backup overdue" : "Backup current") : "No successful backup"}</Chip>
              {backups.lastSuccess && (
                <span className="text-muted">
                  last success {fmtDateTime(backups.lastSuccess.finishedAt)} ({backups.lastSuccess.ageHours} h ago){backups.lastSuccess.label ? ` · ${backups.lastSuccess.label}` : ""}
                </span>
              )}
            </li>
            {backups.lastSuccess && (
              <li className="flex flex-wrap items-center gap-2">
                <Chip tone={backups.lastSuccess.offsiteOk ? "ok" : "warn"}>{backups.lastSuccess.offsiteOk ? "Offsite copy ok" : "No offsite copy"}</Chip>
                {backups.nextDueAt && <span className="text-muted">next due {fmtDateTime(backups.nextDueAt)}</span>}
              </li>
            )}
            {backups.lastRun && backups.lastRun.status !== "succeeded" && (
              <li className="text-[var(--bad-fg)]">
                Last run {backups.lastRun.status} at {fmtDateTime(backups.lastRun.startedAt)}{backups.lastRun.errorMessage ? `: ${backups.lastRun.errorMessage}` : ""}
              </li>
            )}
            <li className="text-muted">Restore drill: none recorded yet (the first drill is due before Gate 9, Phase 9).</li>
          </ul>
        )}
      </Card>

      <Card id="variables">
        <CardTitle>Variables</CardTitle>
        <p className="mb-3 text-[13px] text-muted">Names only: whether each allow-listed variable is set. Values are never shown.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {variables.services.map((s) => (
            <div key={s.service} className="min-w-0">
              <h3 className="mb-1 font-semibold capitalize">{s.service}</h3>
              {s.variables.every((v) => v.present === null) ? (
                <p className="text-[13px] text-muted">Not reported yet: the {s.service} reports its variables with its heartbeat once it runs this release.</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {s.variables.map((v) => (
                    <li key={v.name} className="flex flex-wrap items-center gap-2">
                      <Chip tone={v.present ? "ok" : v.required === "always" ? "bad" : v.required === "production" ? "warn" : "neu"}>{v.present ? "set" : "missing"}</Chip>
                      <span className="break-all font-mono text-[12px]">{v.name}</span>
                      <span className="text-[12px] text-muted">{v.required === "optional" ? v.note : `${v.required === "always" ? "required" : "required in production"} · ${v.note}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/** Cards of later phases (US-1-26 AC2): honest S states that name the phase, never fake data. */
export function PlannedCards() {
  const planned: [string, string][] = [
    ["Database", "Phase 5 (US-5-13)"],
    ["Imports", "Phase 5 (US-5-13)"],
    ["Alerts", "Phase 5 (US-5-13); alert checks already run every 5 minutes and notify administrators in-app"],
    ["Errors", "Phase 5 (US-5-13)"],
    ["Integrations", "Phase 5 (US-5-13)"],
    ["Sync", "Phase 7 (US-7-06)"],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {planned.map(([title, when]) => (
        <Card key={title}>
          <CardTitle>{title}</CardTitle>
          <p className="text-[13px] text-muted">Available in {when}.</p>
        </Card>
      ))}
    </div>
  );
}
