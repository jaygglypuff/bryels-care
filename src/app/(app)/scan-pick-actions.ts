"use server";
import { requireContext } from "@/lib/auth/context";
import { DomainError, toActionState } from "@/lib/errors";
import { PICK_KINDS, type PickCandidate, type PickKind } from "@/lib/scan/pick";
import { findPickCandidates, resolvePickRef } from "@/modules/scan";

/**
 * Thin adapters behind `<ScanOrPick>` (src/ui/scan-or-pick.tsx). Every rule (permission, site scope,
 * refusing the placeholder and labels of another kind) is in src/modules/scan/pick.ts. Read-only.
 */

export type PickSearchResult = { ok: true; candidates: PickCandidate[] } | { ok: false; message: string };
export type PickResolveResult = { ok: true; candidate: PickCandidate } | { ok: false; message: string };

const kindOf = (k: string): PickKind => {
  if (!(PICK_KINDS as readonly string[]).includes(k)) throw new DomainError("validation", "Unknown kind of look-up.");
  return k as PickKind;
};

export async function searchPickAction(kind: string, text: string): Promise<PickSearchResult> {
  try {
    const ctx = await requireContext();
    return { ok: true, candidates: await findPickCandidates(ctx, kindOf(kind), String(text ?? "")) };
  } catch (e) {
    return { ok: false, message: toActionState(e)?.message ?? "Could not search. Try again." };
  }
}

export async function resolvePickAction(kind: string, raw: string): Promise<PickResolveResult> {
  try {
    const ctx = await requireContext();
    return { ok: true, candidate: await resolvePickRef(ctx, kindOf(kind), String(raw ?? "")) };
  } catch (e) {
    return { ok: false, message: toActionState(e)?.message ?? "Could not look it up. Try again." };
  }
}
