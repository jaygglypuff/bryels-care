import "server-only";
import { revalidatePath } from "next/cache";

/**
 * In-place server actions (ADR-043, docs/ux-system.md "Rules: 5.8a In-place actions").
 *
 * An action that leaves the user on the same page calls `refreshCurrentPage()` after the change
 * is committed and before it returns its result. Next.js then renders the page the action was
 * submitted from into the action's own response, so the result message and the fresh data reach
 * the browser together and commit in one React transition. Forms never call `router.refresh()`
 * themselves and never retry with timers.
 *
 * Every page of the app is dynamic (the authenticated layout is `force-dynamic`), so there is no
 * server cache to invalidate: marking the whole tree stale costs nothing on the server and also
 * empties the browser's router cache, so pages visited earlier are re-read on the next visit.
 * (Next.js 16 calls this `refresh()` in `next/cache`; Next.js 15 has no separate API.)
 *
 * Correctness also depends on the route tree: no `loading.tsx` and no `<Suspense>` may wrap a
 * page with in-place actions. See ADR-043 for the React scheduling defect behind that rule;
 * `tests/unit/in-place-actions.test.ts` enforces it.
 */
export function refreshCurrentPage(): void {
  revalidatePath("/", "layout");
}
