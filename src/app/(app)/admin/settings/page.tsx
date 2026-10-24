import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listSettingChangeRequests, listSettingsForAdmin } from "@/modules/governance";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { RequestDecision, SettingForm, type ValueKind } from "./forms";
import { StepUpGate } from "../users/step-up-gate";

export const metadata = { title: "Settings" };

const show = (v: unknown) => (v === null || v === undefined ? "default" : typeof v === "string" ? v : JSON.stringify(v));
function kindOf(v: unknown): ValueKind {
  return typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : typeof v === "string" ? "string" : "json";
}

/**
 * Settings registry admin (US-1-19 AC3) with setting change requests (US-1-14 AC1). Values are
 * configuration; every default names the assumption that needs owner confirmation.
 */
export default async function SettingsPage() {
  const ctx = await requireContext();
  if (!ctx.can("platform.settings.view")) return <Forbidden what="system settings" />;
  const canAdmin = ctx.can("platform.settings.admin");
  const canApprove = ctx.can("platform.settings.approve");
  const [{ rows, orphans }, pending, history] = await Promise.all([listSettingsForAdmin(ctx), listSettingChangeRequests(ctx, { status: "submitted" }), listSettingChangeRequests(ctx, { limit: 25 })]);
  const groups = [...new Set(rows.map((r) => r.def.group))];
  const recent = history.filter((h) => h.status !== "submitted");

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" subtitle="Business configuration as data. Keys marked “needs approval” change only after a second person approves." />
      <StepUpGate ctx={ctx} purpose="change restricted settings" />
      {orphans.length > 0 && (
        <Banner tone="warn" title={`${orphans.length} stored value(s) belong to settings that no longer exist`}>
          {orphans.map((o) => o.key).join(", ")}. They have no effect; remove them with a database change when convenient.
        </Banner>
      )}

      <Card id="pending">
        <CardTitle>Waiting for approval</CardTitle>
        {pending.length === 0 ? (
          <EmptyState title="Nothing is waiting">Changes to keys that need approval appear here until a second administrator or the owner decides.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="appr">Waiting</Chip>
                  <span className="font-medium">{p.label}</span>
                  <span className="font-mono text-[12px] text-muted">{p.key}{p.siteCode ? ` · ${p.siteCode}` : ""}</span>
                </div>
                <p className="mt-1 break-words">
                  <span className="text-muted">From</span> <span className="font-mono">{show(p.oldValue)}</span> <span className="text-muted">to</span> <span className="font-mono">{show(p.newValue)}</span>
                </p>
                <p className="text-muted">
                  {p.submitterName} · {fmtDateTime(p.submittedAt)} · “{p.reason}”
                </p>
                <RequestDecision id={p.id} canApprove={canApprove} isOwn={p.submittedBy === ctx.userId} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {groups.map((g) => (
        <Card key={g} id={`group-${g.toLowerCase()}`}>
          <CardTitle>{g}</CardTitle>
          <ul className="divide-y divide-line">
            {rows
              .filter((r) => r.def.group === g)
              .map((r) => (
                <li key={r.key} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.def.label}</span>
                    {r.def.requiresApproval && <Chip tone="appr">Needs approval</Chip>}
                    {r.def.restricted && <Chip tone="warn">Restricted</Chip>}
                    {r.pending > 0 && <Chip tone="info">{r.pending} waiting</Chip>}
                    {r.invalidStored && <Chip tone="bad">Stored value invalid · default used</Chip>}
                  </div>
                  <p className="font-mono text-[12px] text-muted">{r.key} · assumption {r.def.assumption}</p>
                  {r.def.description && <p className="mt-1 text-[13px] text-muted">{r.def.description}</p>}
                  <p className="mt-1 break-words text-[13px]">
                    Organization: <span className="font-mono">{show(r.organizationValue)}</span> {!r.organizationStored && <span className="text-muted">(default)</span>}
                  </p>
                  {r.siteValues.map((s) => (
                    <p key={s.siteId} className="break-words text-[13px]">
                      Site {s.siteCode}: <span className="font-mono">{show(s.value)}</span>
                    </p>
                  ))}
                  {canAdmin && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[13px] text-primary-text">Change</summary>
                      <SettingForm
                        settingKey={r.key}
                        kind={kindOf(r.def.default)}
                        current={kindOf(r.def.default) === "json" ? JSON.stringify(r.organizationValue) : String(r.organizationValue)}
                        sites={r.def.scopes.includes("site") ? ctx.allowedSites.map((s) => ({ id: s.id, code: s.code })) : []}
                        requiresApproval={!!r.def.requiresApproval}
                      />
                    </details>
                  )}
                </li>
              ))}
          </ul>
        </Card>
      ))}

      <Card id="history">
        <CardTitle>Recent changes</CardTitle>
        {recent.length === 0 ? (
          <EmptyState title="No changes yet">Every applied, rejected or withdrawn change is kept here with who, when and why.</EmptyState>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {recent.map((h) => (
              <li key={h.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={h.status === "applied" ? "ok" : h.status === "rejected" ? "bad" : "neu"}>{h.status}</Chip>
                  <span className="font-medium">{h.label}</span>
                  {h.siteCode && <span className="text-muted">· {h.siteCode}</span>}
                </div>
                <p className="break-words">
                  <span className="font-mono">{show(h.oldValue)}</span> → <span className="font-mono">{show(h.newValue)}</span>
                </p>
                <p className="text-muted">
                  {h.submitterName}
                  {h.deciderName ? ` · decided by ${h.deciderName}` : ""} · {fmtDateTime(h.appliedAt ?? h.updatedAt)} · “{h.reason}”
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
