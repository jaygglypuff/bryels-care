/**
 * Menu paths quoted in messages ("Ask QA to approve one under Management › People, rules and settings › Labels and
 * printouts"). One source, so a menu rename cannot leave old words behind: src/app/(app)/nav.ts builds the menu from
 * the same section name, and tests/unit/menu-paths.test.ts checks that every path quoted in the code exists in the menu.
 * Client-safe (no imports).
 */

/** The Management sub-menu with people, rules and settings (nav.ts `PEOPLE_SETTINGS`). */
export const PEOPLE_SETTINGS = "People, rules and settings";

const path = (...parts: string[]) => parts.join(" › ");

/** Management › People, rules and settings › Labels and printouts (/admin/templates). */
export const LABELS_MENU_PATH = path("Management", PEOPLE_SETTINGS, "Labels and printouts");
/** Management › People, rules and settings › Who says OK to what (/admin/approval-rules). */
export const APPROVAL_RULES_MENU_PATH = path("Management", PEOPLE_SETTINGS, "Who says OK to what");
/** Management › People, rules and settings › Settings (/admin/settings). */
export const SETTINGS_MENU_PATH = path("Management", PEOPLE_SETTINGS, "Settings");

/** Management › People, rules and settings › People who use the app (/admin/users). */
export const USERS_MENU_PATH = path("Management", PEOPLE_SETTINGS, "People who use the app");

/** Every path above, for the menu test. */
export const MENU_PATHS: readonly string[] = [LABELS_MENU_PATH, APPROVAL_RULES_MENU_PATH, SETTINGS_MENU_PATH, USERS_MENU_PATH];
