import { isAre, plural } from "@/lib/plural";
import Link from "next/link";
import { requireContext } from "@/lib/auth/context";
import { fmtDateTime } from "@/lib/qty";
import { listSettingChangeRequests, listSettingsForAdmin, ownerChangesSettingsAlone, settingChangeNext } from "@/modules/governance";
import { NextApprover } from "@/ui/next-approver";
import { EmptyState, PageHeader, buttonClass, cx } from "@/ui/core";
import { MoreDetails, PageIntro } from "@/ui/guide";
import { Callout, Panel, Tabs } from "@/ui/kit";
import { Chip } from "@/ui/status";
import { Info } from "lucide-react";
import { Forbidden } from "../../forbidden";
import { RequestDecision, SettingForm, type ValueKind } from "./forms";
import { StepUpGate } from "../users/step-up-gate";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const show = (v: unknown) => (v === null || v === undefined ? "the starting value" : typeof v === "boolean" ? (v ? "On" : "Off") : typeof v === "string" ? v : typeof v === "number" ? v.toLocaleString("en-PH") : JSON.stringify(v));
/** ADR-126: a choice setting shows its value in words ("Search (recommended)"), never the stored code. */
const choiceWord = (def: { choices?: readonly { value: string; label: string }[] }, v: unknown) => def.choices?.find((c) => c.value === v)?.label ?? show(v);
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
  Screens: "How screens look",
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
  if (!ctx.can("platform.settings.view")) return <Forbidden what="system settings" permission="platform.settings.view" />;
  const canAdmin = ctx.can("platform.settings.admin");
  const canApprove = ctx.can("platform.settings.approve");
  const [{ rows, orphans }, pending, history, alone] = await Promise.all([listSettingsForAdmin(ctx), listSettingChangeRequests(ctx, { status: "submitted" }), listSettingChangeRequests(ctx, { limit: 25 }), ownerChangesSettingsAlone(ctx)]);
  const groups = [...new Set(rows.map((r) => r.def.group))];
  const sp = await searchParams;
  const group = groups.find((g) => slug(g) === sp.group) ?? groups[0];
  const recent = history.filter((h) => h.status !== "submitted");
  // Who approves each waiting change, by name and role (ADR-109).
  const pendingNext = new Map(await Promise.all(pending.map(async (p) => [p.id, await settingChangeNext(ctx, p.id).catch(() => null)] as const)));
  const forMe = pending.filter((p) => canApprove && p.submittedBy !== ctx.userId);

  const inGroup = group ? rows.filter((r) => r.def.group === group) : [];
  const groupLinks = groups.map((g) => ({ key: g, label: groupText(g), href: `/admin/settings?group=${slug(g)}`, count: rows.filter((r) => r.def.group === g).length }));

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle={`${rows.length} settings in ${groups.length} groups${pending.length ? ` · ${pending.length} waiting for OK` : ""}`} />
      <PageIntro>This screen is for the owner and the IT person: how the app behaves (for example how long a sign-in lasts, or whether a second person checks weighings). Pick a group, then press “Change” on a setting. Some changes need a second person&apos;s OK.</PageIntro>
      {/* ADR-136: a compact line only when something waits for this person. */}
      {forMe.length > 0 && (
        <Callout tone="warn" action={<a href="#pending" className={buttonClass("secondary", "sm")}>Decide now</a>}>
          {`${forMe.length} settings ${forMe.length === 1 ? "change waits" : "changes wait"} for your OK.`}
        </Callout>
      )}
      <StepUpGate ctx={ctx} purpose="change settings that need the owner's OK" />
      {orphans.length > 0 && (
        <MoreDetails title={`${plural(orphans.length, "old saved value")} ${isAre(orphans.length)} not used any more (for the IT person)`}>
          <p className="break-words text-[13px] text-muted">{orphans.map((o) => o.key).join(", ")}. They do nothing; the IT person can remove them with a database change.</p>
        </MoreDetails>
      )}

      {pending.length > 0 && (
        <Panel title="Waiting for OK" count={pending.length} id="pending" flush>
          <ul className="divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="px-4 py-3 text-[14px]">
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
                <NextApprover next={pendingNext.get(p.id)} className="text-[13px]" />
                <RequestDecision id={p.id} canApprove={canApprove} isOwn={p.submittedBy === ctx.userId} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {groups.length === 0 ? (
        <EmptyState title="No settings">Settings come with the app. Tell the IT person if this page is empty.</EmptyState>
      ) : (
        // ADR-136: the groups as a list on the left (tabs on a phone), the settings of the open group on the right.
        <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start lg:gap-6">
          <nav aria-label="Setting groups" className="hidden lg:sticky lg:top-[72px] lg:block">
            <ul className="flex flex-col gap-px">
              {groupLinks.map((g) => {
                const on = g.key === group;
                return (
                  <li key={g.key}>
                    <Link
                      href={g.href}
                      aria-current={on ? "page" : undefined}
                      className={cx(
                        "relative flex min-h-[34px] items-center justify-between gap-2 rounded-[6px] px-3 text-[14px]",
                        on ? "bg-[var(--nav-active-bg)] font-semibold text-[var(--nav-active-fg)] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-[2px] before:bg-primary" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
                      )}
                    >
                      {g.label}
                      <span className="text-[12px] font-normal tabular text-muted">{g.count}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <Tabs className="mb-3 lg:hidden" label="Setting groups" active={group ?? ""} items={groupLinks} />
          {group && (
            <Panel title={groupText(group)} count={inGroup.length} flush id={`group-${slug(group)}`}>
              <ul className="divide-y divide-line">
                {inGroup.map((r) => {
                  const facts = (
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-fg">{r.def.label}</span>
                        {/* ADR-126: say who really decides: owner-only keys need the owner; other restricted keys need the password. */}
                        {alone && (r.def.requiresApproval || r.def.ownerOnly) ? (
                          <Chip tone="ok">You can change it alone (with your password)</Chip>
                        ) : (
                          <>
                            {r.def.ownerOnly ? <Chip tone="warn">Only the owner can OK changes</Chip> : r.def.restricted && <Chip tone="warn">Needs your password</Chip>}
                            {r.def.requiresApproval && <Chip tone="appr">A second person must OK changes</Chip>}
                          </>
                        )}
                        {r.pending > 0 && <Chip tone="info">{r.pending} waiting</Chip>}
                        {r.invalidStored && <Chip tone="bad">Saved value is wrong · starting value used</Chip>}
                      </div>
                      <p className="mt-0.5 text-[14px] text-fg-2">{sentence(r.def.description, r.organizationValue)}</p>
                      {r.def.whoChanges && <p className="text-[13px] text-fg-2" data-testid="setting-who">Who should change it: {r.def.whoChanges}</p>}
                      {r.siteValues.map((x) => (
                        <p key={x.siteId} className="break-words text-[13px] text-muted">
                          Only at {x.siteCode}: {show(x.value)}
                        </p>
                      ))}
                    </div>
                  );
                  const now = r.def.description && kindOf(r.def.default) !== "json" ? (
                    <p className="text-[13px] text-fg-2 sm:max-w-[220px] sm:text-right">
                      <span className="text-muted">Now: </span>
                      <span className="font-medium text-fg">{choiceWord(r.def, r.organizationValue)}</span>
                      {!r.organizationStored ? <span className="block text-[12px] text-muted">starting value</span> : null}
                    </p>
                  ) : null;
                  const technical = (
                    <p className="break-all font-mono text-[12px] text-muted">
                      Technical name: {r.key} · assumption {r.def.assumption}
                      {kindOf(r.def.default) === "json" ? ` · value ${JSON.stringify(r.organizationValue)}` : ""}
                    </p>
                  );
                  return (
                    <li key={r.key} className="px-4 py-3" data-testid={`setting-${r.key}`}>
                      {canAdmin ? (
                        <details className="group">
                          <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-start sm:gap-4 [&::-webkit-details-marker]:hidden">
                            {facts}
                            {now}
                            <span className={cx(buttonClass("secondary", "sm"), "shrink-0 self-start")}>
                              <span className="group-open:hidden">Change</span>
                              <span className="hidden group-open:inline">Close</span>
                            </span>
                          </summary>
                          <SettingForm
                            settingKey={r.key}
                            kind={kindOf(r.def.default)}
                            current={kindOf(r.def.default) === "json" ? JSON.stringify(r.organizationValue) : String(r.organizationValue)}
                            sites={r.def.scopes.includes("site") ? ctx.allowedSites.map((x) => ({ id: x.id, code: x.code })) : []}
                            requiresApproval={!!r.def.requiresApproval}
                            choices={r.def.choices ? [...r.def.choices] : undefined}
                          />
                          <div className="mt-2">{technical}</div>
                        </details>
                      ) : (
                        <>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                            {facts}
                            {now}
                          </div>
                          <details className="mt-1">
                            <summary className="flex min-h-[32px] cursor-pointer items-center text-[13px] text-muted pointer-coarse:min-h-[44px]">Technical name</summary>
                            {technical}
                          </details>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      )}

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
      {orphans.length === 0 && (
        <p className="flex items-start gap-2 text-[13px] text-fg-2">
          <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-muted" />
          <span>
            <b className="font-semibold text-fg">Starting values are guesses.</b> Values marked “starting value” were chosen for the demo and must be checked by the owner (and, for quality or money rules, by the qualified person) before real use.
          </span>
        </p>
      )}
    </div>
  );
}
