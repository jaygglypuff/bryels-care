import { randomUUID } from "node:crypto";
import { requireContext } from "@/lib/auth/context";
import { DEFAULT_REASON_CODES, reasonCodeOptions } from "@/modules/masterdata";
import { db } from "@/db/client";
import { MIGRATION_ONLY_ADJUSTMENT_REASONS } from "@/modules/inventory/adjustments";
import { Card, PageHeader } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Forbidden } from "../../../forbidden";
import { AdjustmentForm } from "../adjustment-form";
import { plainAdjustmentReason } from "../reason-words";

export const metadata = { title: "Fix stock" };

/**
 * Fix stock (stock adjustment, US-2-19; usability test 2026-10-30): reasons in plain words; the
 * data-migration reasons are offered to administrators only (inventory.balance.admin; the service refuses
 * them for anyone else too). Lots are looked up by scan or typing, not from an 80-item list.
 */
export default async function NewAdjustmentPage() {
  const ctx = await requireContext();
  if (!ctx.can("inventory.adjustment.create") || !ctx.can("inventory.lot.view")) return <Forbidden what="fixing stock" />;
  const isAdmin = ctx.can("inventory.balance.admin");
  const defaults = new Map(DEFAULT_REASON_CODES.map((r) => [r.code, r.name]));
  const reasons = (await reasonCodeOptions(db, ctx.organizationId, "adjustment"))
    .filter((r) => r.code !== "found_unlabelled")
    .filter((r) => isAdmin || !(MIGRATION_ONLY_ADJUSTMENT_REASONS as readonly string[]).includes(r.code))
    .map((r) => ({ code: r.code, requiresNote: r.requiresNote, label: plainAdjustmentReason(r.code, r.label, defaults.get(r.code)) }));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Fix stock" subtitle={ctx.currentSite.name} />
      <PageIntro>This screen is for telling us that stock was found, is missing or got damaged. Say what happened, scan or find each lot by name, and send it; a manager approves it before stock changes.</PageIntro>
      <Card>
        <AdjustmentForm reasons={reasons} idempotencyKey={randomUUID()} />
      </Card>
    </div>
  );
}
