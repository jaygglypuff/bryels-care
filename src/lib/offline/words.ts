/**
 * ADR-134 item 3: what a screen says when a save cannot reach the server. Isomorphic and pure.
 *
 * Saves that are queued on the device (counting, weighing on the Weigh card) never get here. Every other save is
 * refused with this sentence instead of an error page: nothing was saved, and on the production floor the work goes
 * on the paper batch record and is typed in later ("Enter from the paper record").
 */
import type { ActionState } from "@/lib/errors";

export const NO_INTERNET_SAVE =
  "No internet. Nothing was saved. Try again when the internet is back. On the production floor, write it on the paper batch record now and type it in later (open the batch, then Enter from the paper record).";

/** True when the error means the request never reached the server (or the browser says it is offline). */
export function isNoConnection(e: unknown, online: boolean): boolean {
  if (!online) return true;
  if (!(e instanceof TypeError)) return false;
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(e.message);
}

/** False only when the browser says it is offline (Node and old browsers: treated as online). */
export function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function noInternetState(): ActionState {
  return { ok: false, tone: "warn", message: NO_INTERNET_SAVE };
}

/**
 * Wraps a server action for `useActionState`: a lost connection becomes the plain "No internet. Nothing was saved."
 * state; every other error is thrown as before (the page's error boundary).
 */
export function withNoInternet<S extends ActionState>(action: (prev: S, fd: FormData) => Promise<S>): (prev: S, fd: FormData) => Promise<S> {
  return async (prev, fd) => {
    try {
      return await action(prev, fd);
    } catch (e) {
      if (isNoConnection(e, browserOnline())) return noInternetState() as S;
      throw e;
    }
  };
}
