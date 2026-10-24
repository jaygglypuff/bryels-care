import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type AuthContext, requireContext } from "@/lib/auth/context";
import { type ActionState, toActionState } from "@/lib/errors";

/**
 * Thin server-action adapter for the W2G screens: builds the AuthContext, calls one service
 * function, maps DomainErrors to form state, revalidates and optionally redirects. No business
 * logic here; the service validates and authorizes.
 */
export async function act<R>(
  fn: (ctx: AuthContext) => Promise<R>,
  opts: { revalidate: string[]; redirectTo?: (r: R) => string; message?: string | ((r: R) => string) },
): Promise<ActionState> {
  const ctx = await requireContext();
  let target: string | null = null;
  let message = "Saved.";
  try {
    const r = await fn(ctx);
    target = opts.redirectTo ? opts.redirectTo(r) : null;
    if (opts.message) message = typeof opts.message === "function" ? opts.message(r) : opts.message;
  } catch (e) {
    return toActionState(e);
  }
  for (const p of opts.revalidate) revalidatePath(p);
  if (target) redirect(target);
  return { ok: true, message };
}

/** Form fields as a plain object; keys starting with "_" are routing ids, not service input. */
export function formInput(fd: FormData, multi: string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$") || k.startsWith("_") || multi.includes(k)) continue;
    o[k] = typeof v === "string" ? v : "";
  }
  for (const m of multi) o[m] = fd.getAll(m).map(String);
  return o;
}

export const field = (fd: FormData, k: string) => String(fd.get(k) ?? "");
