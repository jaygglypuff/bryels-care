import { RESOLVABLE_KINDS } from "@/modules/platform";

/**
 * "Needs me" (round 5 leftovers, ADR-132 §1): ONE number with ONE definition, used by the menu badge ("Needs me", the
 * manager phone's "To check/approve") and by Home's "Needs you" card.
 *
 *   things waiting for this person's action
 *     = approvals they can decide now                        (the "To approve" page, decidable rows)
 *     + checks waiting for them                               (Home "Waiting for you to check": weighing, step, box checks)
 *     + open messages that ask them to act                    (not FYI; not resolved, not taken on with "I'm on it")
 *
 * A message "asks to act" when its kind clears itself once the work is done (`RESOLVABLE_KINDS`, notification-done.ts):
 * those are exactly the messages that say "do this". Alerts and notes ("document ready", "low stock") are FYI.
 *
 * Nothing is counted twice:
 * - a message about a record that is on the person's approvals list (decidable or waiting for someone else) is the
 *   approval, not a message;
 * - weighing, step and start check messages, and box checks of a delivery, are the checks list (one card per batch);
 * - several messages about the same record (confirmed → set aside) count once.
 */
export type NeedsMeCount = { approvals: number; checks: number; messages: number; total: number };
export type NeedsMeMessage = { kind: string; entityId: string | null; entityType: string | null };

const ACTION_KINDS: ReadonlySet<string> = new Set(RESOLVABLE_KINDS);
/** Message kinds that the checks list already shows. */
const CHECK_KINDS: ReadonlySet<string> = new Set(["handoff.weighing_check", "handoff.step_check", "handoff.start_check"]);

export function isActionMessage(m: NeedsMeMessage): boolean {
  return ACTION_KINDS.has(m.kind);
}

export function countNeedsMe(input: { approvals: readonly { entityId: string; canDecide: boolean }[]; checks: readonly { key: string }[]; messages: readonly NeedsMeMessage[] }): NeedsMeCount {
  const approvals = input.approvals.filter((a) => a.canDecide).length;
  const onApprovals = new Set(input.approvals.map((a) => a.entityId));
  const seen = new Set<string>();
  let messages = 0;
  for (const m of input.messages) {
    if (!isActionMessage(m) || CHECK_KINDS.has(m.kind)) continue;
    if (m.kind === "handoff.pack_check" && m.entityType === "shipment") continue;
    if (m.entityId && onApprovals.has(m.entityId)) continue;
    if (m.entityId) {
      if (seen.has(m.entityId)) continue;
      seen.add(m.entityId);
    }
    messages++;
  }
  const checks = input.checks.length;
  return { approvals, checks, messages, total: approvals + checks + messages };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;

/** "1 approval · 4 messages" (the Home card line under the number). */
export function needsMeBreakdown(n: NeedsMeCount): string {
  const parts = [n.approvals ? plural(n.approvals, "approval", "approvals") : null, n.checks ? plural(n.checks, "check", "checks") : null, n.messages ? plural(n.messages, "message", "messages") : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing waits for you";
}
