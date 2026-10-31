import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listSettingChangeRequests, listSettingsForAdmin } from "@/modules/governance";
import { Card, CardTitle, EmptyState, PageHeader, cx } from "@/ui/core";
import { MoreDetails, NextStep, PageIntro } from "@/ui/guide";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../forbidden";
import { RequestDecision, SettingForm, type ValueKind } from "./forms";
import { StepUpGate } from "../users/step-up-gate";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const show = (v: unknown) => (v === null || v === undefined ? "the starting value" : typeof v === "boolean" ? (v ? "On" : "Off") : typeof v === "string" ? v : typeof v === "number" ? v.toLocaleString("en-PH") : JSON.stringify(v));
function kindOf(v: unknown): ValueKind {
  return typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : typeof v === "string" ? "string" : "json";
}

/** One sentence of what the setting does: its written description, or the current value in words. */
function sentence(description: string | undefined, value: unknown): string {
  if (description) return description;
  if (typeof value === "boolean") return `Switched ${value ? "on" : "off"} now.`;
  if (Array.isArray(value)) return `A list of ${value.length} ${value.length === 1 ? "item" : "items"}; open “Change” to see it.`;
  if (value && typeof value === "object") return "Several values together; open “Change” to see them.";
  return `Now: ${show(value)}.`;
}

/** Plain group names (ADR-088). */
const GROUP_TEXT: Record<string, string> = {
  Platform: "System",
  Offline: "Working without signal",
  Fulfilment: "Packing and sending",
  Procurement: "Buying from suppliers",
  Retention: "Keeping and deleting old records",
  "Action centre": "Problems and alerts",
  Inventory: "Stock",
  Production: "Making products",
};
const groupText = (g: string) => GROUP_TEXT[g] ?? g;
const slug = (g: string) => g.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Settings registry admin (US-1-19 AC3) with setting change requests (US-1-14 AC1), grade-5 layout
 * (ADR-088): one group at a time (chips), each setting by its plain label and one sentence; the key and
 * its assumption id only under "More details". Values are configuration; every default names the
 * assumption that needs owner confirmation.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.can("platform.settings.view")) return <Forbidden what="system settings" />;
  const canAdmin = ctx.can("platform.settings.admin");
  const canApprove = ctx.can("platform.settings.approve");
  const [{ rows, orphans }, pending, history] = await Promise.all([listSettingsForAdmin(ctx), listSettingChangeRequests(ctx, { status: "submitted" }), listSettingChangeRequests(ctx, { limit: 25 })]);
  const groups = [...new Set(rows.map((r) => r.def.group))];
  const sp = await searchParams;
  const group = groups.find((g) => slug(g) === sp.group) ?? groups[0];
  const recent = history.filter((h) => h.status !== "submitted");
  const forMe = pending.filter((p) => canApprove && p.submittedBy !== ctx.userId);

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" />
      <PageIntro>This screen is for the owner and the IT person: how the app behaves (for example how long a sign-in lasts, or whether a second person checks weighings). Pick a group, then press “Change” on a setting. Some changes need a second person&apos;s OK.</PageIntro>
      {forMe.length > 0 && <NextStep text={`${forMe.length} settings ${forMe.length === 1 ? "change waits" : "changes wait"} for your OK.`} action={{ label: "Decide now", href: "#pending" }} />}
      <StepUpGate ctx={ctx} purpose="change settings that need the owner's OK" />
      {orphans.length > 0 && (
        <MoreDetails title={`${orphans.length} old saved value(s) are not used any more (for the IT person)`}>
          <p className="break-words text-[13px] text-muted">{orphans.map((o) => o.key).join(", ")}. They do nothing; the IT person can remove them with a database change.</p>
        </MoreDetails>
      )}

      {pending.length > 0 && (
        <Card id="pending">
          <CardTitle>Waiting for OK</CardTitle>
          <ul className="divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="py-3 text-[14px]">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone="appr">Waiting</Chip>
                  <span className="font-medium">{p.label}</span>
                  {p.siteCode && <span className="text-muted">· only {p.siteCode}</span>}
                </div>
                <p className="mt-1 break-words">
                  From <b>{show(p.oldValue)}</b> to <b>{show(p.newValue)}</b>
                </p>
                <p className="text-[13px] text-muted">
                  {p.submitterName} · {fmtDateTime(p.submittedAt)} · “{p.reason}”
                </p>
                <RequestDecision id={p.id} canApprove={canApprove} isOwn={p.submittedBy === ctx.userId} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <nav aria-label="Setting groups" className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <Link
            key={g}
            href={`/admin/settings?group=${slug(g)}`}
            aria-current={g === group ? "page" : undefined}
            className={cx("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[14px]", g === group ? "border-ring bg-primary-soft font-semibold" : "border-line hover:bg-surface-2")}
          >
            {groupText(g)}
          </Link>
        ))}
      </nav>

      {group && (
        <Card id={`group-${slug(group)}`}>
          <CardTitle>{groupText(group)}</CardTitle>
          <ul className="divide-y divide-line">
            {rows
              .filter((r) => r.def.group === group)
              .map((r) => (
                <li key={r.key} className="py-3" data-testid={`setting-${r.key}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium">{r.def.label}</span>
                    {r.def.restricted && <Chip tone="warn">Needs the owner&apos;s OK</Chip>}
                    {r.def.requiresApproval && <Chip tone="appr">A second person must OK changes</Chip>}
                    {r.pending > 0 && <Chip tone="info">{r.pending} waiting</Chip>}
                    {r.invalidStored && <Chip tone="bad">Saved value is wrong · starting value used</Chip>}
                  </div>
                  <p className="mt-1 text-[14px] text-fg-2">{sentence(r.def.description, r.organizationValue)}</p>
                  {r.def.description && kindOf(r.def.default) !== "json" && <p className="text-[13px] text-muted">Now: {show(r.organizationValue)}{!r.organizationStored ? " (starting value)" : ""}</p>}
                  {r.siteValues.map((s) => (
                    <p key={s.siteId} className="break-words text-[13px] text-muted">
                      Only at {s.siteCode}: {show(s.value)}
                    </p>
                  ))}
                  <div className="mt-1 flex flex-wrap gap-x-4">
                    {canAdmin && (
                      <details className="min-w-0 flex-1">
                        <summary className="flex min-h-[44px] cursor-pointer items-center text-[14px] font-medium text-primary-text">Change</summary>
                        <SettingForm
                          settingKey={r.key}
                          kind={kindOf(r.def.default)}
                          current={kindOf(r.def.default) === "json" ? JSON.stringify(r.organizationValue) : String(r.organizationValue)}
                          sites={r.def.scopes.includes("site") ? ctx.allowedSites.map((s) => ({ id: s.id, code: s.code })) : []}
                          requiresApproval={!!r.def.requiresApproval}
                        />
                      </details>
                    )}
                    <details className="min-w-0">
                      <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] text-muted">Technical name</summary>
                      <p className="break-all font-mono text-[12px] text-muted">
                        {r.key} · assumption {r.def.assumption}
                        {kindOf(r.def.default) === "json" ? ` · value ${JSON.stringify(r.organizationValue)}` : ""}
                      </p>
                    </details>
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      )}
      {groups.length === 0 && <EmptyState title="No settings">Settings come with the app. Tell the IT person if this page is empty.</EmptyState>}

      <div id="history">
        <MoreDetails title="Recent changes (history)">
          {recent.length === 0 ? (
            <p className="text-[14px] text-fg-2">No changes yet. Every change, “not OK” and taken-back request is kept here with who, when and why.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {recent.map((h) => (
                <li key={h.id} className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={h.status === "applied" ? "ok" : h.status === "rejected" ? "bad" : "neu"}>{h.status === "applied" ? "Done" : h.status === "rejected" ? "Not OK'd" : "Taken back"}</Chip>
                    <span className="font-medium">{h.label}</span>
                    {h.siteCode && <span className="text-muted">· {h.siteCode}</span>}
                  </div>
                  <p className="break-words">
                    {show(h.oldValue)} → {show(h.newValue)}
                  </p>
                  <p className="text-muted">
                    {h.submitterName}
                    {h.deciderName ? ` · decided by ${h.deciderName}` : ""} · {fmtDateTime(h.appliedAt ?? h.updatedAt)} · “{h.reason}”
                  </p>
                </li>
              ))}
            </ul>
          )}
        </MoreDetails>
      </div>
      {orphans.length === 0 && <Banner tone="info" title="Starting values are guesses">Values marked “starting value” were chosen for the demo and must be checked by the owner (and, for quality or money rules, by the qualified person) before real use.</Banner>}
    </div>
  );
}
