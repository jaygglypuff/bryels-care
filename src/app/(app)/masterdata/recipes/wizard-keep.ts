/**
 * The recipe wizard keeps what was typed on this device until it is saved (owner bug report 2026-11-06, ADR-116):
 * "it fails to save and then restarts again — not even saved as a draft". A save that never reached the server (the
 * connection dropped, the app was updated while the wizard was open, the person was signed out) used to throw inside
 * the wizard, the page's error screen replaced it, and "Try again" started an empty wizard.
 *
 * Kept in `sessionStorage` (this browser tab only, gone when the tab closes; nothing on a shared device outlives the
 * tab), per signed-in person and per recipe, with a fingerprint of the server's starting point: a copy made from an
 * older version of the recipe is not restored over a newer one. Cleared when the save succeeds. Pure, unit-tested in
 * tests/unit/recipe-wizard-keep.test.ts.
 */

export type KeptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type Kept<D> = { v: 1; base: string; savedAt: string; screen: number; draft: D };

const PREFIX = "bc.recipe-wizard.v1";

/** One key per person, kind of wizard and recipe ("new" for a new recipe). */
export function keptKey(owner: string, kind: string, formulaId: string | null | undefined): string {
  return `${PREFIX}:${owner}:${kind}:${formulaId || "new"}`;
}

/** A short fingerprint of a JSON value (djb2): the server's starting point the copy was made from. */
export function fingerprint(value: unknown): string {
  const s = JSON.stringify(value) ?? "";
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The kept copy when it was made from the same starting point; null otherwise (or when storage is unavailable). */
export function readKept<D>(storage: KeptStorage | null | undefined, key: string, base: string): Kept<D> | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const k = JSON.parse(raw) as Kept<D>;
    if (k?.v !== 1 || k.base !== base || !k.draft) return null;
    return k;
  } catch {
    return null;
  }
}

/** Stores the copy; never throws (a full or blocked storage only means nothing is kept). */
export function writeKept<D>(storage: KeptStorage | null | undefined, key: string, base: string, screen: number, draft: D, now: Date = new Date()): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ v: 1, base, savedAt: now.toISOString(), screen, draft } satisfies Kept<D>));
  } catch {
    // nothing kept; the wizard still works
  }
}

export function clearKept(storage: KeptStorage | null | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

/** The plain message when a call to the server failed before it answered (thrown instead of returning a result). */
export const NOT_REACHED =
  "Not saved: the app could not reach the server (the connection dropped, or the app was just updated). Nothing you typed is lost: it is kept on this device. Reload the page if this repeats, then press the button again.";

/**
 * Calls a server action and turns a throw (network, an updated app, a server restart) into a plain failed result, so
 * the wizard never falls into the page's error screen and loses what was typed.
 */
export async function safeCall<R extends { ok: boolean; message?: string }>(call: () => Promise<R>): Promise<R | { ok: false; message: string; fieldErrors?: undefined; data?: undefined }> {
  try {
    const r = await call();
    if (!r || typeof r !== "object") return { ok: false, message: NOT_REACHED };
    return r;
  } catch {
    return { ok: false, message: NOT_REACHED };
  }
}

/** "10:42" in Manila time, for "kept on this device at 10:42". */
export function keptTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila" });
}
