import Decimal from "decimal.js";
import { APPROVAL_DOCUMENT_TYPES, APPROVAL_THRESHOLD_BASES } from "@/db/schema";
import { requireContext } from "@/lib/auth/context";
import { PERMISSIONS, ROLE_BUNDLES } from "@/lib/permissions";
import { type ApprovalRuleSpec, listApprovalRules } from "@/modules/governance";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { PageIntro } from "@/ui/guide";
import { plainRole } from "@/ui/role-names";
import { basisText, docTypeText } from "./words";
import { Forbidden } from "../../forbidden";
import { RemoveRuleForm, RuleForm, type RuleFormValue } from "./forms";
import { StepUpGate } from "../users/step-up-gate";

export const metadata = { title: "Approval rules" };

const role = (c: string) => plainRole(c, ROLE_BUNDLES[c]?.name ?? c.replace(/_/g, " "));
const fmt = (v: string | null) => (v === null ? null : new Decimal(v).toString());

function condition(r: Pick<ApprovalRuleSpec, "minValue" | "maxValue" | "currency"> & { thresholdBasis: string }) {
  if (r.thresholdBasis === "always") return "Always";
  if (r.thresholdBasis === "credit_check_failed") return "When the customer is over their credit limit";
  const unit = r.thresholdBasis === "amount" ? ` ${r.currency ?? ""}` : r.thresholdBasis.endsWith("pct") ? " %" : "";
  const parts = [r.minValue !== null ? `more than ${fmt(r.minValue)}${unit}` : null, r.maxValue !== null ? `up to ${fmt(r.maxValue)}${unit}` : null].filter(Boolean);
  return `${basisText(r.thresholdBasis)} ${parts.join(" and ")}`;
}

/** Approval rules (US-1-14 AC2–AC3): the owner edits; system admins, site managers and auditors read. */
export default async function ApprovalRulesPage() {
  const ctx = await requireContext();
  if (!ctx.can("platform.approval_rule.view")) return <Forbidden what="approval rules" />;
  const canAdmin = ctx.can("platform.approval_rule.admin");
  const { rules, defaults } = await listApprovalRules(ctx);
  const active = rules.filter((r) => !r.deletedAt);
  const types = [...new Set([...active.map((r) => r.documentType), ...defaults.map((d) => d.documentType)])].sort();
  const siteCode = new Map(ctx.allowedSites.map((s) => [s.id, s.code]));
  const opts = {
    documentTypes: [...APPROVAL_DOCUMENT_TYPES],
    bases: [...APPROVAL_THRESHOLD_BASES],
    roles: Object.entries(ROLE_BUNDLES).map(([code, b]) => ({ code, name: b.name })),
    permissions: PERMISSIONS.filter((p) => p.endsWith(".approve")),
    sites: ctx.allowedSites.map((s) => ({ id: s.id, code: s.code })),
  };
  const today = new Date().toISOString().slice(0, 10);
  const blank: RuleFormValue = { documentType: "stock_adjustment", siteId: null, label: "Approval", thresholdBasis: "always", minValue: null, maxValue: null, currency: null, step: 1, requiredCount: 1, requiredRoleCodes: [], requiredPermissionCode: null, posterMayEqualApprover: false, escalationRoleCodes: null, escalationAfterHours: null, effectiveFrom: today, effectiveTo: null, source: null };

  return (
    <div className="space-y-5">
      <PageHeader title="Who says OK to what" />
      <PageIntro>This screen is for the owner: which things need an OK, from whom, and above which amount. Nobody says OK to their own request (the owner and the site manager may, for their own work, if that is switched on). The starting rules are guesses for the owner to check.</PageIntro>
      <StepUpGate ctx={ctx} purpose="change approval rules" />
      {!canAdmin && <Banner tone="info" title="You can look, not change">Only the owner changes these rules (they protect money and quality).</Banner>}
      {canAdmin && (
        <Card>
          <details>
            <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold text-primary-text">Add a rule</summary>
            <RuleForm value={blank} opts={opts} />
          </details>
        </Card>
      )}
      {types.length === 0 && <EmptyState title="No rules yet">Anyone allowed to approve a thing may say OK. Press “Add a rule” to ask for a second person above an amount.</EmptyState>}
      {types.map((t) => {
        const rows = active.filter((r) => r.documentType === t).sort((a, b) => (a.siteId ?? "").localeCompare(b.siteId ?? "") || a.step - b.step);
        const defs = defaults.filter((d) => d.documentType === t);
        return (
          <Card key={t} id={`type-${t}`}>
            <CardTitle>{docTypeText(t)}</CardTitle>
            {defs.length > 0 && <p className="mb-2 text-[13px] text-muted">Starting rules (nothing saved yet). Adding a rule saves these first.</p>}
            <ul className="divide-y divide-line text-[13px]">
              {defs.map((d, i) => (
                <li key={`d${i}`} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="neu">Step {d.step}</Chip>
                    <span className="font-medium">{d.label}</span>
                    <Chip tone="info">starting rule</Chip>
                  </div>
                  <p className="text-muted">{condition(d)} · {d.requiredRoleCodes.length ? d.requiredRoleCodes.map(role).join(" or ") : "anyone allowed to approve"}{d.escalationRoleCodes ? ` · if nobody decides in ${d.escalationAfterHours} h, tell ${d.escalationRoleCodes.map(role).join(", ")}` : ""}</p>
                </li>
              ))}
              {rows.map((r) => (
                <li key={r.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="neu">Step {r.step}</Chip>
                    <span className="font-medium">{r.label}</span>
                    {r.siteId && <Chip tone="appr">Only {siteCode.get(r.siteId) ?? "?"}</Chip>}
                    {r.requiredCount > 1 && <Chip tone="warn">{r.requiredCount} people must say OK</Chip>}
                    {r.effectiveTo && <Chip tone="neu">until {r.effectiveTo}</Chip>}
                    {r.effectiveFrom > today && <Chip tone="info">from {r.effectiveFrom}</Chip>}
                  </div>
                  <p className="text-muted">
                    {condition(r)} · {r.requiredRoleCodes.length ? r.requiredRoleCodes.map(role).join(" or ") : "anyone allowed to approve"}
                    {r.escalationRoleCodes ? ` · if nobody decides in ${r.escalationAfterHours} h, tell ${r.escalationRoleCodes.map(role).join(", ")}` : ""}
                    {r.source ? ` · ${r.source}` : ""}
                  </p>
                  {canAdmin && (
                    <details className="mt-1">
                      <summary className="flex min-h-[44px] cursor-pointer items-center text-primary-text">Change or remove</summary>
                      <RuleForm value={{ ...r, documentType: r.documentType, requiredRoleCodes: r.requiredRoleCodes ?? [], escalationRoleCodes: r.escalationRoleCodes ?? null }} opts={opts} />
                      <RemoveRuleForm id={r.id} />
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
