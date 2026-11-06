"use server";
import { revalidatePath } from "next/cache";
import { type AuthContext, getContext } from "@/lib/auth/context";
import { type ActionState, DomainError, toActionState } from "@/lib/errors";
import { createRecipeIngredient, createRecipePackaging, createRecipeProduct, getRecipeCopy, saveRecipe } from "@/modules/masterdata";

/**
 * Server actions of the guided recipe wizard (ADR-089): thin adapters that call the masterdata
 * services (which validate, authorize, transact and audit) and map errors to a form state. No
 * business rules here.
 */
export type WizardResult<T> = NonNullable<ActionState> & { data?: T };

async function run<T>(fn: () => Promise<{ data: T; message: string }>, paths: string[] = []): Promise<WizardResult<T>> {
  try {
    const { data, message } = await fn();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message, data };
  } catch (e) {
    return toActionState(e) as WizardResult<T>;
  }
}

/**
 * The signed-in person, or a plain refusal. `requireContext` would redirect from inside the action, which `run` turned
 * into "Something went wrong" (owner bug report 2026-11-06): a person signed out while typing a long recipe is told
 * what happened, and the wizard keeps what they typed (on this device) for after they sign in again.
 */
async function requireContext(): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) throw new DomainError("unauthenticated", "You were signed out, so nothing was saved. What you typed is kept on this device: sign in again, open this recipe again and press Save.");
  return ctx;
}

export async function saveRecipeAction(payload: unknown) {
  return run(
    async () => {
      const ctx = await requireContext();
      const r = await saveRecipe(ctx, payload);
      return { data: r, message: r.message };
    },
    ["/masterdata/recipes", "/masterdata/formulas", "/masterdata/routings", "/masterdata/products", "/approvals"],
  );
}

export async function createRecipeProductAction(payload: unknown) {
  return run(
    async () => {
      const ctx = await requireContext();
      const p = await createRecipeProduct(ctx, payload);
      return { data: p, message: `Product ${p.name} made (${p.code}).` };
    },
    ["/masterdata/products"],
  );
}

export async function createRecipeIngredientAction(payload: unknown) {
  return run(
    async () => {
      const ctx = await requireContext();
      const m = await createRecipeIngredient(ctx, payload);
      return { data: m, message: `Ingredient ${m.name} added (${m.code}).` };
    },
    ["/masterdata/materials"],
  );
}

export async function createRecipePackagingAction(payload: unknown) {
  return run(
    async () => {
      const ctx = await requireContext();
      const m = await createRecipePackaging(ctx, payload);
      return { data: m, message: `Packaging item ${m.name} added (${m.code}).` };
    },
    ["/masterdata/materials"],
  );
}

export async function loadRecipeCopyAction(formulaId: string) {
  return run(async () => {
    const ctx = await requireContext();
    const c = await getRecipeCopy(ctx, formulaId);
    return { data: c, message: `Copied the ingredients and steps of ${c.from}.` };
  });
}
