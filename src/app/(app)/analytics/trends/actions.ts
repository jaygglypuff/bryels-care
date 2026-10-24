"use server";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { deleteTrendView, saveTrendView } from "@/modules/analytics";

/** Trends page actions (thin adapters; the rules live in src/modules/analytics/kpis.ts). In-place: refreshCurrentPage (ADR-043). */

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function saveViewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const config = JSON.parse(str(fd, "config") || "{}");
    await saveTrendView(ctx, { name: str(fd, "name"), config });
    refreshCurrentPage();
    return { ok: true, message: `View "${str(fd, "name").trim()}" saved.` };
  } catch (e) {
    return toActionState(e);
  }
}

export async function deleteViewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await deleteTrendView(ctx, z.string().uuid().parse(str(fd, "viewId")));
    refreshCurrentPage();
    return { ok: true, message: "View removed." };
  } catch (e) {
    return toActionState(e);
  }
}
