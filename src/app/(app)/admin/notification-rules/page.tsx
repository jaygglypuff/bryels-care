import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { ACTION_KINDS, listNotificationRules, ruleRoleOptions } from "@/modules/action-centre";
import { Card, EmptyState, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { plainRole } from "@/ui/role-names";
import { Forbidden } from "../../forbidden";
import { NotificationRuleForm } from "./forms";

export const metadata = { title: "Who gets which message" };

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
  const opts = { kinds: ACTION_KINDS.map((k) => ({ kind: k.kind, label: `${k.tab === "approvals" ? "Waits for OK" : "Problem"}: ${k.label}` })), roles, sites: ctx.allowedSites.map((s) => ({ id: s.id, code: s.code })) };
  const roleName = (c: string) => plainRole(c, roles.find((r) => r.code === c)?.name ?? c);
  return (
    <div className="space-y-5">
      <PageHeader title="Who gets which message" />
      <PageIntro>This screen is for the owner and the IT person: when a problem appears (for example a late order), who gets a message, and who is told next if nobody reacts in time. Problems without a rule still show in “Problems &amp; alerts”.</PageIntro>
      <Card>
        {rules.length === 0 ? (
          <EmptyState title="No rules yet">Problems still show in “Problems &amp; alerts”, but nobody gets a message. Add a rule below.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={r.isActive ? "ok" : "neu"}>{r.isActive ? "On" : "Off"}</Chip>
                  <Chip tone={r.severity === "critical" ? "bad" : r.severity === "warning" ? "warn" : "info"}>{r.severity === "critical" ? "Urgent" : r.severity === "warning" ? "Soon" : "Info"}</Chip>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-[12px] text-muted">{r.kindLabel} · {r.siteId ? (ctx.allowedSites.find((s) => s.id === r.siteId)?.code ?? "site") : "every site"} · changed {fmtDateTime(r.updatedAt)}</span>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  Tells {(r.ownerRoleCodes as string[]).map(roleName).join(", ") || "nobody"}
                  {r.escalateAfterHours ? ` · if nobody reacts in ${r.escalateAfterHours} h, also ${(r.escalationRoleCodes as string[]).map(roleName).join(", ")}` : ""}
                  {r.emailOnOpen ? " · by email too" : ""}
                </p>
                {admin && (
                  <details className="mt-2">
                    <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Change</summary>
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
          <details>
          <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-primary-text">Add a rule</summary>
          <NotificationRuleForm value={{ itemKind: ACTION_KINDS[0].kind, siteId: null, name: "", severity: "warning", ownerRoleCodes: [], escalateAfterHours: null, escalationRoleCodes: [], emailOnOpen: false, emailOnEscalation: true, isActive: true }} opts={opts} />
          </details>
        </Card>
      )}
    </div>
  );
}
