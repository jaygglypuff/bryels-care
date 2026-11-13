import "server-only";
import { cache } from "react";
import type { AuthContext } from "@/lib/auth/context";
import { needsMeSummary } from "@/modules/analytics";
import { navPersona } from "./nav";

/**
 * ADR-132 §1: the frame badge ("Needs me", "To check/approve") and Home's "Needs you" card read this one function, once
 * per request. The owner is not offered floor checks (B report #9) and the sales desk has none; everyone else counts
 * the checks waiting for them.
 */
export const needsMeFor = cache(async (ctx: AuthContext) => {
  const persona = navPersona((p) => ctx.can(p), ctx.roleCodes);
  return needsMeSummary(ctx, { checks: persona !== "owner" && persona !== "sales" });
});
