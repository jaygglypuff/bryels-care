import "server-only";
import { inArray, and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { SETTINGS } from "@/lib/settings";

/**
 * ADR-126: the organisation settings that change what screens show, read once per request for pages and the app
 * frame. Every rule they control is also enforced in its service (`checkEntryMode`, `masterSearch`,
 * `billingStepOfShipment` …); these values only decide what is shown, so a screen never offers what the server refuses.
 */
export type ScreenPreferences = {
  /** `scan.typed_code_counts_as_check`: the verification checks show the "type the number" box. */
  typedChecks: boolean;
  /** `ui.wide_screen_top_bar`: what the top bar shows from 1024 px. */
  wideTopBar: "search" | "scan";
  /** `scan.search_open_to_everyone` combined with the person's `inventory.lot.view`: this person may use the search. */
  canSearch: boolean;
  /** `ui.setup_edit_forms_folded`: setup pages fold their edit form under "Change the details". */
  setupFormsFolded: boolean;
  /** ADR-135 `ui.number_entry`: the big keypad, the device's own keyboard, or automatic (keypad on touch screens). */
  numberEntry: "keypad" | "keyboard" | "auto";
};

const KEYS = ["scan.typed_code_counts_as_check", "ui.wide_screen_top_bar", "scan.search_open_to_everyone", "ui.setup_edit_forms_folded", "ui.number_entry"] as const;
type Key = (typeof KEYS)[number];

/** One query for the organisation rows of the screen settings; a missing or invalid row falls back to the default. */
export async function screenPreferences(ctx: AuthContext): Promise<ScreenPreferences> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(eq(settings.organizationId, ctx.organizationId), eq(settings.scope, "organization"), isNull(settings.siteId), isNull(settings.userId), inArray(settings.key, [...KEYS])));
  const read = <K extends Key>(key: K) => {
    const row = rows.find((r) => r.key === key);
    const parsed = row ? SETTINGS[key].schema.safeParse(row.value) : null;
    return (parsed?.success ? parsed.data : SETTINGS[key].default) as (typeof SETTINGS)[K]["default"];
  };
  const openToAll = read("scan.search_open_to_everyone");
  return {
    typedChecks: read("scan.typed_code_counts_as_check"),
    wideTopBar: read("ui.wide_screen_top_bar"),
    canSearch: openToAll || ctx.can("inventory.lot.view"),
    setupFormsFolded: read("ui.setup_edit_forms_folded"),
    numberEntry: read("ui.number_entry"),
  };
}
