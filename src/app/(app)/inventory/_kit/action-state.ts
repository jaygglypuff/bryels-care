import { DomainError, toActionState, type ActionState } from "@/lib/errors";

/** Like toActionState, but also passes field errors carried in DomainError details to the form. */
export function actionError(e: unknown): ActionState {
  if (e instanceof DomainError) {
    const fe = (e.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
    return { ok: false, message: e.message, ...(fe ? { fieldErrors: fe } : {}) };
  }
  return toActionState(e);
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
