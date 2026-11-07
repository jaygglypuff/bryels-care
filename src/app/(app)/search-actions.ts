"use server";
import { requireContext } from "@/lib/auth/context";
import { masterSearch, MAX_QUERY_LENGTH, type MasterGroup } from "@/modules/scan";
import { commonScreens, searchScreens, type ScreenHit } from "./search-screens";

export type MasterSearchResponse = {
  query: string;
  screens: ScreenHit[];
  groups: MasterGroup[];
  /** The one record whose number was typed exactly (Enter opens it). */
  exactHref: string | null;
  /** Empty box: a few common screens for the person's role. */
  common: ScreenHit[];
  error?: string;
};

/**
 * The master search behind the top-bar box, Ctrl/⌘+K and the Scan or search screen (owner request 2026-11-08).
 * Reads only. Screens come from the menu filtered by the person's permissions; records from `masterSearch`, which
 * checks the permission and sites of every record type on the server.
 */
export async function masterSearchAction(input: string): Promise<MasterSearchResponse> {
  const ctx = await requireContext();
  const query = String(input ?? "").slice(0, MAX_QUERY_LENGTH).trim();
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.can(p);
  if (!query) return { query, screens: [], groups: [], exactHref: null, common: commonScreens(can, ctx.roleCodes) };
  const screens = searchScreens(query, can, ctx.roleCodes);
  try {
    const r = await masterSearch(ctx, query);
    return { query, screens, groups: r.groups, exactHref: r.exactHref, common: [] };
  } catch (e) {
    console.error(e);
    return { query, screens, groups: [], exactHref: null, common: [], error: "The search did not work just now. Check your connection and try again." };
  }
}
