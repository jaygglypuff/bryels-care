"use server";
import { requireContext } from "@/lib/auth/context";
import { DomainError, type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { confirmRetentionPolicy, executePurgeNow, placeLegalHold, releaseLegalHold, runRetentionSweep, saveRetentionPolicy, signOffRestoreDrill } from "@/modules/platform";

/*
 * Retention screen actions (US-9-05, US-9-03). Thin adapters over the platform retention services; every
 * rule (permissions, re-authentication, separation of duties, protected classes, holds) is enforced there.
 * In-place: the page re-renders in the action response (ADR-043).
 */
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function withField(e: unknown): ActionState {
  const s = toActionState(e);
  if (e instanceof DomainError && typeof e.details?.field === "string" && s) return { ...s, fieldErrors: { ...(s.fieldErrors ?? {}), [e.details.field]: e.message } };
  return s;
}

export async function savePolicyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const unit = str(f, "unit");
    const value = Number(str(f, "value"));
    const min = str(f, "minimumMonths");
    await saveRetentionPolicy(
      ctx,
      {
        dataClass: str(f, "dataClass") as never,
        target: str(f, "target"),
        period: unit === "none" ? { unit: "none" } : ({ unit, value } as never),
        basis: str(f, "basis") as never,
        minimumMonths: min ? Number(min) : null,
        action: str(f, "action") as never,
        effectiveFrom: str(f, "effectiveFrom"),
        reason: str(f, "reason"),
      },
      String(f.get("password") ?? "") || null,
    );
    refreshCurrentPage();
    return { ok: true, message: "Policy saved. It is unconfirmed until a qualified reviewer's confirmation is recorded; the sweep only reports it until then." };
  } catch (e) {
    return withField(e);
  }
}

export async function confirmPolicyAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await confirmRetentionPolicy(ctx, { dataClass: str(f, "dataClass"), target: str(f, "target"), note: str(f, "note") }, String(f.get("password") ?? "") || null);
    refreshCurrentPage();
    return { ok: true, message: "Confirmation recorded. The sweep may now act on this policy." };
  } catch (e) {
    return withField(e);
  }
}

export async function placeHoldAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const h = await placeLegalHold(ctx, { holdKind: str(f, "holdKind") as never, entityType: str(f, "entityType") as never, reference: str(f, "reference"), reason: str(f, "reason") });
    refreshCurrentPage();
    return { ok: true, message: `Legal hold placed on ${h.entityLabel}. No retention action touches it until a different person releases it.` };
  } catch (e) {
    return withField(e);
  }
}

export async function releaseHoldAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await releaseLegalHold(ctx, { id: str(f, "id"), note: str(f, "note") });
    refreshCurrentPage();
    return { ok: true, message: "Legal hold released." };
  } catch (e) {
    return withField(e);
  }
}

export async function dryRunAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await runRetentionSweep(ctx, { mode: "dry_run", trigger: "manual", idempotencyKey: str(f, "idempotencyKey") || null });
    refreshCurrentPage();
    return { ok: true, message: `Dry run finished: nothing was deleted. ${r.candidateRows} rows are past their period, ${r.heldRows} are held. See the report below.` };
  } catch (e) {
    return withField(e);
  }
}

export async function executePurgeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const r = await executePurgeNow(ctx, { idempotencyKey: str(f, "idempotencyKey") || null }, String(f.get("password") ?? "") || null);
    refreshCurrentPage();
    return { ok: true, message: `Purge finished: ${r.deletedRows} rows deleted under confirmed policies; ${r.heldRows} held rows kept.` };
  } catch (e) {
    return withField(e);
  }
}

export async function signOffDrillAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await signOffRestoreDrill(ctx, { id: str(f, "id"), note: str(f, "note") }, String(f.get("password") ?? "") || null);
    refreshCurrentPage();
    return { ok: true, message: "Restore drill signed off." };
  } catch (e) {
    return withField(e);
  }
}
