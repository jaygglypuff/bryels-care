"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";
import { refreshCurrentPage } from "@/lib/in-place";
import { PriceListSchema, approvePriceList, createPriceList, issuesToFieldErrors, newPriceListVersion, rejectPriceList, retirePriceList, submitPriceList, updatePriceListDraft } from "@/modules/sales";

/** Price list actions (US-4-03): thin adapters; the service enforces permissions, SoD and states. */
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
const uuid = z.string().uuid("Choose a valid option.");

function parseList(fd: FormData) {
  let lines: unknown = [];
  try {
    lines = JSON.parse(str(fd, "lines") ?? "[]");
  } catch {
    lines = [];
  }
  return PriceListSchema.safeParse({
    code: str(fd, "code"),
    name: str(fd, "name"),
    partyKind: str(fd, "partyKind"),
    customerId: str(fd, "customerId"),
    effectiveFrom: str(fd, "effectiveFrom"),
    changeSummary: str(fd, "changeSummary"),
    lines,
  });
}

export async function savePriceListAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const parsed = parseList(fd);
    if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: issuesToFieldErrors(parsed.error.issues) };
    const existing = str(fd, "priceListId");
    if (existing) {
      id = uuid.parse(existing);
      await updatePriceListDraft(ctx, id, parsed.data);
    } else {
      id = (await createPriceList(ctx, parsed.data)).id;
    }
    if (str(fd, "submitNow") === "on") await submitPriceList(ctx, id);
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/price-lists");
  redirect(`/sales/price-lists/${id}?saved=1`);
}

export async function priceListCommandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const id = uuid.parse(str(fd, "priceListId"));
    const cmd = z.enum(["submit", "approve", "return", "reject", "retire"]).parse(str(fd, "command"));
    const reason = str(fd, "reason") ?? "";
    let message = "";
    if (cmd === "submit") {
      await submitPriceList(ctx, id);
      message = "Sent for approval. Finance or the owner approves it.";
    } else if (cmd === "approve") {
      const r = await approvePriceList(ctx, id, str(fd, "note") || null);
      message = r.approved ? "Approved: the prices apply from the effective date." : "Your approval is recorded; another step is open.";
    } else if (cmd === "retire") {
      await retirePriceList(ctx, id, reason);
      message = "Retired: no longer used for new quotations and orders.";
    } else {
      await rejectPriceList(ctx, id, reason, { returnToDraft: cmd === "return" });
      message = cmd === "return" ? "Returned to draft for changes." : "Rejected.";
    }
    refreshCurrentPage();
    return { ok: true, message };
  } catch (e) {
    return toActionState(e);
  }
}

export async function newVersionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireContext();
    const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.").parse(str(fd, "effectiveFrom"));
    id = (await newPriceListVersion(ctx, uuid.parse(str(fd, "priceListId")), from)).id;
  } catch (e) {
    return toActionState(e);
  }
  revalidatePath("/sales/price-lists");
  redirect(`/sales/price-lists/${id}/edit`);
}
