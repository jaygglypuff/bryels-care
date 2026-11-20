import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { recipeTemplates, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { ADD_METHODS, RECORD_BY } from "./add-methods";
import { idempotent } from "./idempotency";
import { parseInput } from "./schemas";

/**
 * ADR-137 "Save as a template": a custom step, or a custom way of adding an ingredient, that a site keeps to use again
 * in later recipes. A template is only a starting point the wizard copies into a recipe; the copy is saved, approved and
 * frozen with the recipe as usual (a template change never changes a recipe).
 *
 * Permissions: see = `masterdata.formula.view` or `masterdata.routing.view`, at the person's own sites; save and stop
 * using = `masterdata.formula.edit` (ways of adding) or `masterdata.routing.edit` (steps), at that site. Audited
 * (`masterdata.recipe_template.saved` / `.retired`). One active template per name, kind and site.
 */

const s = (max: number) => z.string().max(max, `Use at most ${max} characters.`);

/** A way of adding (no ingredient, no amount: those belong to the recipe line). */
export const AddMethodTemplateBody = z
  .object({
    method: z.enum(ADD_METHODS),
    customName: s(80).default(""),
    customUnit: s(30).default(""),
    customUnitQty: s(30).default(""),
    diffKind: z.enum(["pct", "g", "units"]).default("units"),
    diff: s(30).default(""),
    needsCheck: z.boolean().default(true),
    recordBy: z.enum(RECORD_BY).optional(),
    readingName: s(60).default(""),
    readingUnit: s(20).default(""),
    readingMin: s(30).default(""),
    readingMax: s(30).default(""),
    note: s(300).default(""),
  })
  .strict()
  .superRefine((b, c) => {
    if (b.method === "custom" && !b.customName.trim()) c.addIssue({ code: "custom", path: ["customName"], message: "Give your way a name." });
    if (b.method === "custom" && !b.customUnit.trim()) c.addIssue({ code: "custom", path: ["customUnit"], message: "Name the unit, like scoop." });
    if (b.customUnitQty.trim() && !/^\d{1,9}(\.\d{1,6})?$/.test(b.customUnitQty.trim())) c.addIssue({ code: "custom", path: ["customUnitQty"], message: "Type how much one unit is, as a number." });
  });

const Reading = z
  .object({ name: s(120).min(1, "Name the field."), kind: z.enum(["number", "yesno", "text", "choice"]), unit: s(20), min: s(30), max: s(30), target: s(30).default(""), code: s(40).default(""), required: z.boolean(), options: z.array(s(40)).max(12).optional() })
  .strict();

/** A step the writer built (the wizard's step without its place in a recipe). */
export const StepTemplateBody = z
  .object({
    name: s(120).min(1, "Give the step a name."),
    instruction: s(2000).default(""),
    stepKind: z.enum(["process", "hold", "in_process_qc", "checklist"]).default("process"),
    needsCheck: z.boolean().default(false),
    qaSigns: z.boolean().default(false),
    waitAmount: s(20).default(""),
    waitUnit: z.enum(["minutes", "hours", "days", "weeks"]).default("minutes"),
    checklist: z.array(z.object({ text: s(300), requiresPhoto: z.boolean(), isBlocking: z.boolean() }).strict()).max(40).default([]),
    readings: z.array(Reading).max(30).default([]),
  })
  .strict();

const SaveInput = z
  .object({
    siteId: z.string().uuid("Choose the site."),
    kind: z.enum(["step", "add_method"]),
    name: z.string().trim().min(1, "Give the template a name.").max(80, "Use at most 80 characters."),
    body: z.unknown(),
    idempotencyKey: z.string().max(100).nullish(),
  })
  .strict();
const RetireInput = z.object({ templateId: z.string().uuid(), reason: z.string().trim().min(5, "Say why (at least 5 letters).").max(300), idempotencyKey: z.string().max(100).nullish() }).strict();

const editPermission = (kind: string) => (kind === "step" ? "masterdata.routing.edit" : "masterdata.formula.edit") as "masterdata.routing.edit" | "masterdata.formula.edit";

export type RecipeTemplateRow = { id: string; siteId: string; kind: "step" | "add_method"; name: string; body: unknown; createdByName: string; createdAt: Date };

/** Active templates at the person's sites (current site first). */
export async function listRecipeTemplates(ctx: AuthContext, opts: { kind?: "step" | "add_method" } = {}): Promise<RecipeTemplateRow[]> {
  if (!ctx.can("masterdata.formula.view") && !ctx.can("masterdata.routing.view")) ctx.require("masterdata.formula.view");
  const sites = ctx.allowedSiteIds;
  if (!sites.length) return [];
  const rows = await db
    .select({ t: recipeTemplates, by: users.displayName })
    .from(recipeTemplates)
    .innerJoin(users, eq(users.id, recipeTemplates.createdBy))
    .where(and(eq(recipeTemplates.organizationId, ctx.organizationId), inArray(recipeTemplates.siteId, sites), eq(recipeTemplates.status, "active"), opts.kind ? eq(recipeTemplates.kind, opts.kind) : undefined))
    .orderBy(asc(sql`lower(${recipeTemplates.name})`));
  return rows
    .map((r) => ({ id: r.t.id, siteId: r.t.siteId, kind: r.t.kind as "step" | "add_method", name: r.t.name, body: r.t.body, createdByName: r.by, createdAt: r.t.createdAt }))
    .sort((a, b) => Number(b.siteId === ctx.currentSiteId) - Number(a.siteId === ctx.currentSiteId));
}

/** "Save as a template" (step builder or the own-way fields of an ingredient line). */
export async function saveRecipeTemplate(ctx: AuthContext, raw: unknown) {
  const v = parseInput(SaveInput, raw);
  ctx.require(editPermission(v.kind));
  ctx.requireSite(v.siteId);
  const body = v.kind === "step" ? parseInput(StepTemplateBody, v.body) : parseInput(AddMethodTemplateBody, v.body);
  return db.transaction(async (tx) => {
    const { result } = await idempotent(tx, ctx, v.idempotencyKey, "masterdata.recipe_template.save", async () => {
      const [dupe] = await tx
        .select({ id: recipeTemplates.id })
        .from(recipeTemplates)
        .where(and(eq(recipeTemplates.siteId, v.siteId), eq(recipeTemplates.kind, v.kind), eq(recipeTemplates.status, "active"), sql`lower(${recipeTemplates.name}) = lower(${v.name})`))
        .limit(1);
      if (dupe) throw new DomainError("conflict", `There is already a template called "${v.name}" at this site. Use another name.`, { fieldErrors: { name: "Name already used." } });
      const [row] = await tx.insert(recipeTemplates).values({ organizationId: ctx.organizationId, siteId: v.siteId, kind: v.kind, name: v.name, body, createdBy: ctx.userId }).returning();
      await audit(tx, ctx, { action: "masterdata.recipe_template.saved", entityType: "recipe_template", entityId: row.id, entityNumber: v.name, siteId: v.siteId, after: { kind: v.kind, name: v.name, body } });
      return { templateId: row.id, name: row.name };
    });
    return result;
  });
}

/** "Stop using this template" (recipes that copied it keep their copy). */
export async function retireRecipeTemplate(ctx: AuthContext, raw: unknown) {
  const v = parseInput(RetireInput, raw);
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(recipeTemplates).where(and(eq(recipeTemplates.id, v.templateId), eq(recipeTemplates.organizationId, ctx.organizationId))).for("update").limit(1);
    if (!t || !ctx.allowedSiteIds.includes(t.siteId)) throw new DomainError("not_found", "Template not found.");
    ctx.require(editPermission(t.kind));
    ctx.requireSite(t.siteId);
    const { result } = await idempotent(tx, ctx, v.idempotencyKey, "masterdata.recipe_template.retire", async () => {
      if (t.status !== "active") throw new DomainError("state", "This template is already stopped.");
      await tx.update(recipeTemplates).set({ status: "retired", retiredBy: ctx.userId, retiredAt: new Date(), retiredReason: v.reason }).where(eq(recipeTemplates.id, t.id));
      await audit(tx, ctx, { action: "masterdata.recipe_template.retired", entityType: "recipe_template", entityId: t.id, entityNumber: t.name, siteId: t.siteId, reason: v.reason, before: { status: "active" }, after: { status: "retired" } });
      return { templateId: t.id };
    });
    return result;
  });
}
