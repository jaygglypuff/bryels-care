"use server";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { MAX_RAW_LENGTH } from "@/lib/scan/payload";
import { resolveScanCard, type ScanCard } from "@/modules/scan";

/** Resolves one scan into a result card (reads only; scoped and rate limited on the server). */
export async function scanCardAction(raw: string): Promise<ScanCard> {
  const ctx = await requireContext();
  const code = String(raw ?? "").slice(0, MAX_RAW_LENGTH * 2);
  try {
    return await resolveScanCard(ctx, code);
  } catch (e) {
    if (e instanceof DomainError && e.code === "forbidden") return { outcome: "forbidden", payload: code, message: e.message };
    console.error(e);
    return { outcome: "not_found", payload: code, message: "The look-up failed. Check your connection and scan again." };
  }
}
