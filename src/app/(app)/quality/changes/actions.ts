"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { toActionState, type ActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { cancelChangeControl, closeChangeControl, createChangeControl, decideChangeControl, implementChangeControl, submitChangeControl, updateChangeControl } from "@/modules/quality";

/* Change control server actions (US-6-18): thin adapters; the service checks every rule (ADR-043 in-place refresh). */

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const opt = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || String(v).trim() === "" ? null : String(v);
};

async function inPlace(run: () => Promise<string>): Promise<ActionState> {
  try {
    const message = await run();
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function createChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const r = await createChangeControl(ctx, {
      title: str(fd, "title"),
      description: str(fd, "description"),
      justification: str(fd, "justification"),
      entityType: str(fd, "entityType"),
      entityId: opt(fd, "entityId"),
      capaId: opt(fd, "capaId"),
      siteId: opt(fd, "siteId"),
      targetDate: opt(fd, "targetDate"),
      idempotencyKey: opt(fd, "idempotencyKey"),
    });
    id = r.changeControlId;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/quality/changes");
  redirect(`/quality/changes/${id}?created=1`);
}

export async function updateChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await updateChangeControl(ctx, {
      changeControlId: str(fd, "changeControlId"),
      title: opt(fd, "title") ?? undefined,
      description: opt(fd, "description") ?? undefined,
      justification: opt(fd, "justification") ?? undefined,
      impactAssessment: opt(fd, "impactAssessment"),
      riskLevel: opt(fd, "riskLevel"),
      implementationPlan: opt(fd, "implementationPlan"),
      targetDate: opt(fd, "targetDate"),
    });
    return "Proposal saved.";
  });
}

export async function linkChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await updateChangeControl(ctx, { changeControlId: str(fd, "changeControlId"), entityId: opt(fd, "entityId") });
    return "Implementing revision linked.";
  });
}

export async function submitChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await submitChangeControl(ctx, { changeControlId: str(fd, "changeControlId") });
    return "Submitted for approval; the approvers were notified.";
  });
}

export async function decideChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    const decision = str(fd, "decision") as "approved" | "rejected" | "returned";
    const r = await decideChangeControl(ctx, { changeControlId: str(fd, "changeControlId"), decision, note: opt(fd, "note") });
    return r.status === "approved" ? "Change approved." : r.status === "rejected" ? "Change rejected." : r.status === "draft" ? "Returned to the proposer for rework." : "Your approval is recorded; the next step is pending.";
  });
}

export async function implementChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await implementChangeControl(ctx, { changeControlId: str(fd, "changeControlId"), note: str(fd, "note") });
    return "Change recorded as implemented. Another person confirms and closes it.";
  });
}

export async function closeChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await closeChangeControl(ctx, { changeControlId: str(fd, "changeControlId"), note: opt(fd, "note") });
    return "Change closed.";
  });
}

export async function cancelChangeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return inPlace(async () => {
    const ctx = await requireContext();
    await cancelChangeControl(ctx, { changeControlId: str(fd, "changeControlId"), reason: str(fd, "reason") });
    return "Change cancelled.";
  });
}
