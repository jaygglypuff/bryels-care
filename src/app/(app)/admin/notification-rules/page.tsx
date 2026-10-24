import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { ACTION_KINDS, listNotificationRules, ruleRoleOptions } from "@/modules/action-centre";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { NotificationRuleForm } from "./forms";

export const metadata = { title: "Notification rules" };

/**
 * Notification rules and escalation (US-5-07): read with platform.notification_rule.view, change with
 * platform.notification_rule.admin (audited platform.notification_rule.changed). Defaults are seeded
 * suggestions for the owner to confirm (A-W3B-08).
 */
export default async function NotificationRulesPage() {
  const ctx = await requireContext();
  if (!ctx.can("platform.notification_rule.view")) return <Forbidden what="notification rules" />;
  const [rules, roles] = await Promise.all([listNotificationRules(ctx), ruleRoleOptions(ctx)]);
  const admin = ctx.can("platform.notification_rule.admin");
  const opts = { kinds: ACTION_KINDS.map((k) => ({ kind: k.kind, label: `${k.tab === "approvals" ? "Approval" : "Exception"}: ${k.label}` })), roles, sites: ctx.allowedSites.map((s) => ({ id: s.id, code: s.code })) };
  const roleName = (c: string) => roles.find((r) => r.code === c)?.name ?? c;
  return (
    <div className="space-y-5">
      <PageHeader title="Notification rules" subtitle="Who is told when an action-centre item opens, and who hears about it when nobody acknowledges it in time. Kinds without a rule still appear in the action centre for everyone allowed to act." />
      <Card>
        {rules.length === 0 ? (
          <EmptyState title="No rules yet">Without rules items still show in the action centre, but nobody is notified or escalated.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={r.isActive ? "ok" : "neu"}>{r.isActive ? "Active" : "Off"}</Chip>
                  <Chip tone={r.severity === "critical" ? "bad" : r.severity === "warning" ? "warn" : "info"}>{r.severity}</Chip>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-[12px] text-muted">{r.kindLabel} · {r.siteId ? (ctx.allowedSites.find((s) => s.id === r.siteId)?.code ?? "site") : "every site"} · v{r.version} · changed {fmtDateTime(r.updatedAt)}</span>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  Notifies {(r.ownerRoleCodes as string[]).map(roleName).join(", ") || "nobody"}
                  {r.escalateAfterHours ? ` · escalates after ${r.escalateAfterHours} h to ${(r.escalationRoleCodes as string[]).map(roleName).join(", ")}` : " · no escalation"}
                  {r.emailOnOpen ? " · email on open" : ""}
                  {r.emailOnEscalation && r.escalateAfterHours ? " · email on escalation" : ""}
                </p>
                {admin && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-primary-text">Change</summary>
                    <div className="mt-2">
                      <NotificationRuleForm value={{ ...r, ownerRoleCodes: r.ownerRoleCodes as string[], escalationRoleCodes: r.escalationRoleCodes as string[] }} opts={opts} />
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {admin && (
        <Card>
          <CardTitle>Add a rule</CardTitle>
          <NotificationRuleForm value={{ itemKind: ACTION_KINDS[0].kind, siteId: null, name: "", severity: "warning", ownerRoleCodes: [], escalateAfterHours: null, escalationRoleCodes: [], emailOnOpen: false, emailOnEscalation: true, isActive: true }} opts={opts} />
        </Card>
      )}
    </div>
  );
}
