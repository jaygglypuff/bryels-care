"use server";
import { requireContext } from "@/lib/auth/context";
import { limitScanLookup } from "@/lib/rate-limit";
import { FLOOR_RECORD_TYPES, masterSearch, MAX_QUERY_LENGTH, SEARCH_NEEDS_STOCK_ACCESS, searchAllowed, type MasterGroup } from "@/modules/scan";
import { commonScreens, searchActions, searchScreens, type ScreenHit } from "./search-screens";
import { isFloor, navPersona } from "./nav";

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

/** Plain answer when the person searched too often (same limiter and budget as the scan look-up, ADR-125). */
const SEARCH_RATE_LIMITED = "Too many searches in a minute. Wait a moment, then search again.";

/**
 * The master search behind the top-bar box, Ctrl/⌘+K and the Scan or search screen (owner request 2026-11-08).
 * Reads only. Screens come from the menu filtered by the person's permissions; records from `masterSearch`, which
 * checks the permission and sites of every record type on the server. Record look-ups count against the scan
 * look-up limit (`limitScanLookup`, `platform.rate_limits.scan_lookups_per_minute` per person); over it the menu
 * screens still show (no database) and the records wait.
 */
export async function masterSearchAction(input: string): Promise<MasterSearchResponse> {
  const ctx = await requireContext();
  const query = String(input ?? "").slice(0, MAX_QUERY_LENGTH).trim();
  // ADR-126: with `scan.search_open_to_everyone` off the search needs stock access (masterSearch refuses too).
  if (!(await searchAllowed(ctx))) return { query, screens: [], groups: [], exactHref: null, common: [], error: SEARCH_NEEDS_STOCK_ACCESS };
  const can = (p: Parameters<typeof ctx.can>[0]) => ctx.can(p);
  if (!query) return { query, screens: [], groups: [], exactHref: null, common: commonScreens(can, ctx.roleCodes) };
  // Round 5: things to do ("new customer") first, then screens (questions such as "who owes us" included).
  const screens = [...searchActions(query, can), ...searchScreens(query, can, ctx.roleCodes)];
  if (!(await limitScanLookup(ctx.organizationId, ctx.userId)).allowed) return { query, screens, groups: [], exactHref: null, common: [], error: SEARCH_RATE_LIMITED };
  try {
    // ADR-132 §4: floor people (operator, checker, warehouse) get batches, lots, boxes, shelves, orders and deliveries.
    const floor = isFloor(navPersona(can, ctx.roleCodes));
    const r = await masterSearch(ctx, query, floor ? { onlyTypes: FLOOR_RECORD_TYPES } : {});
    return { query, screens, groups: r.groups, exactHref: r.exactHref, common: [] };
  } catch (e) {
    console.error(e);
    return { query, screens, groups: [], exactHref: null, common: [], error: "The search did not work just now. Check your connection and try again." };
  }
}
