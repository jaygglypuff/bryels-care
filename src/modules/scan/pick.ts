import "server-only";
import { and, asc, eq, gt, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { batches, containerContents, containers, inventoryBalances, inventoryLots, locations, materials, products } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { D, fmtDate } from "@/lib/qty";
import { classifyPickInput, notFoundMessage, type PickCandidate, type PickKind } from "@/lib/scan/pick";
import { fmtFriendly } from "@/lib/units";
import { isPastExpiry } from "@/modules/inventory";
import { searchTerms } from "./search";

/**
 * Server side of `<ScanOrPick>` (owner review 2026-10-31): find candidates by words and resolve one
 * scanned label, typed number or tapped id to a candidate. Read-only.
 *
 * Scope (the same as the commands that use the value; they check again on save):
 * | Kind      | Needs                    | Scope                                   |
 * |-----------|--------------------------|-----------------------------------------|
 * | lot       | inventory.lot.view       | current site                            |
 * | container | inventory.container.view | current site                            |
 * | location  | signed in at the site    | current site, active places             |
 * | batch     | production.batch.view    | current site                            |
 * | item      | inventory.lot.view       | organisation master data (active)       |
 * A record of another site (even one the caller may see) is "not found here": the operator acts at the
 * current site. The placeholder text, empty input and labels of another kind are refused.
 */

const LIMIT = 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, string> = { quarantine: "waiting for QA check", on_hold: "stopped by QA", rejected: "rejected", expired: "expired", recalled: "recalled", released: "OK to use" };

function words(cols: (SQL | AnyColumn)[], text: string): SQL[] {
  return searchTerms(text).map((w) => {
    const like = `%${w}%`;
    return sql`(${sql.join(
      cols.map((c) => sql`coalesce(${c}::text, '') ilike ${like}`),
      sql` or `,
    )})`;
  });
}

type LotRow = { id: string; lotNumber: string; status: string; expiresOn: string | null; baseUom: string; name: string; supplierLot: string | null };

/** Lot candidates with the places that hold them at the current site. */
async function lotCandidates(ctx: AuthContext, where: SQL[]): Promise<PickCandidate[]> {
  const onHand = sql<string>`coalesce((select sum(b.qty_base) from inventory_balances b where b.lot_id = ${inventoryLots.id}), 0)`;
  const rows: LotRow[] = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      status: inventoryLots.qualityStatus,
      expiresOn: inventoryLots.expiresOn,
      baseUom: inventoryLots.baseUom,
      name: sql<string>`coalesce(${materials.name}, ${products.name}, '')`,
      supplierLot: inventoryLots.supplierLotNumber,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.siteId, ctx.currentSiteId), ...where))
    // Live audit 2026-10-31: usable stock first (use-first order), waiting for QA next, expired or stopped last.
    .orderBy(
      sql`${onHand} > 0 desc`,
      sql`case when ${inventoryLots.qualityStatus} in ('rejected','recalled','expired','on_hold') or ${inventoryLots.expiresOn} < (now() at time zone 'Asia/Manila')::date then 2 when ${inventoryLots.qualityStatus} = 'quarantine' then 1 else 0 end`,
      sql`${inventoryLots.expiresOn} asc nulls last`,
      inventoryLots.lotNumber,
    )
    .limit(LIMIT);
  if (!rows.length) return [];
  const bals = await db
    .select({ lotId: inventoryBalances.lotId, id: locations.id, code: locations.code, name: locations.name, qty: inventoryBalances.qtyBase })
    .from(inventoryBalances)
    .innerJoin(locations, eq(locations.id, inventoryBalances.locationId))
    .where(and(inArray(inventoryBalances.lotId, rows.map((r) => r.id)), gt(inventoryBalances.qtyBase, "0"), eq(locations.siteId, ctx.currentSiteId)))
    .orderBy(asc(locations.code));
  return rows.map((r) => {
    const places = bals.filter((b) => b.lotId === r.id).map((b) => ({ value: b.id, title: b.name, detail: `${b.code} · ${fmtFriendly(b.qty, r.baseUom)} here`, codes: [b.code], code: b.code }));
    const expired = isPastExpiry(r.expiresOn) && !["rejected", "recalled"].includes(r.status);
    const sum = bals.filter((b) => b.lotId === r.id).reduce((a, b) => a.plus(b.qty), D(0));
    const total = sum.gt(0) ? fmtFriendly(sum, r.baseUom) : "none left";
    return {
      value: r.id,
      title: r.name || r.lotNumber,
      // Where, how much, until when, then the number (live audit: rows must differ by more than the lot code).
      detail: [places.length ? `${total} on ${places.map((p) => p.title).join(", ")}` : total, r.expiresOn ? `${expired ? "EXPIRED" : "use by"} ${fmtDate(r.expiresOn)}` : null, `lot ${r.lotNumber}`].filter(Boolean).join(" · "),
      code: r.lotNumber,
      codes: [r.lotNumber, ...(r.supplierLot ? [r.supplierLot.toUpperCase()] : [])],
      uom: r.baseUom,
      places,
      badge: expired ? "expired" : STATUS[r.status] ?? r.status.replace(/_/g, " "),
      badgeTone: expired || ["rejected", "recalled", "on_hold"].includes(r.status) ? "bad" : r.status === "quarantine" ? "warn" : "ok",
    } satisfies PickCandidate;
  });
}

async function containerCandidates(ctx: AuthContext, where: SQL[]): Promise<PickCandidate[]> {
  const rows = await db
    .select({ id: containers.id, number: containers.containerNumber, status: containers.status, kind: containers.containerKind, loc: locations.code })
    .from(containers)
    .leftJoin(locations, eq(locations.id, containers.currentLocationId))
    .where(and(eq(containers.organizationId, ctx.organizationId), eq(containers.siteId, ctx.currentSiteId), inArray(containers.status, ["open", "sealed", "in_transit"]), ...where))
    .orderBy(containers.containerNumber)
    .limit(LIMIT);
  if (!rows.length) return [];
  const contents = await db
    .select({ containerId: containerContents.containerId, qty: containerContents.qtyBase, uom: containerContents.baseUom, lotNumber: inventoryLots.lotNumber, name: sql<string>`coalesce(${materials.name}, ${products.name}, '')` })
    .from(containerContents)
    .innerJoin(inventoryLots, eq(inventoryLots.id, containerContents.lotId))
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(inArray(containerContents.containerId, rows.map((r) => r.id)), gt(containerContents.qtyBase, "0")));
  return rows.map((r) => {
    const inside = contents.filter((c) => c.containerId === r.id);
    return {
      value: r.id,
      title: inside.length ? inside.map((c) => `${fmtFriendly(c.qty, c.uom)} ${c.name}`).join(" + ") : "Empty box",
      detail: [`box ${r.number}`, inside.length ? `lot ${[...new Set(inside.map((c) => c.lotNumber))].join(", ")}` : null, r.loc ? `on ${r.loc}` : null].filter(Boolean).join(" · "),
      code: r.number,
      codes: [r.number],
    } satisfies PickCandidate;
  });
}

async function locationCandidates(ctx: AuthContext, where: SQL[]): Promise<PickCandidate[]> {
  const rows = await db
    .select({ id: locations.id, code: locations.code, name: locations.name, kind: locations.kind })
    .from(locations)
    .where(and(eq(locations.siteId, ctx.currentSiteId), eq(locations.isActive, true), ...where))
    .orderBy(locations.code)
    .limit(LIMIT);
  return rows.map((r) => ({ value: r.id, title: r.name, detail: r.code, code: r.code, codes: [r.code] }));
}

async function batchCandidates(ctx: AuthContext, where: SQL[]): Promise<PickCandidate[]> {
  const rows = await db
    .select({ id: batches.id, number: batches.batchNumber, status: batches.status, name: products.name, outputLot: batches.outputLotNumber })
    .from(batches)
    .innerJoin(products, eq(products.id, batches.productId))
    .where(and(eq(batches.organizationId, ctx.organizationId), eq(batches.siteId, ctx.currentSiteId), ...where))
    .orderBy(sql`${batches.createdAt} desc`)
    .limit(LIMIT);
  // ADR-099: the lot number on the batch's product labels also finds the batch.
  return rows.map((r) => ({ value: r.id, title: r.name, detail: `batch ${r.number} · ${r.status.replace(/_/g, " ")}`, code: r.number, codes: r.outputLot ? [r.number, r.outputLot] : [r.number] }));
}

async function itemCandidates(ctx: AuthContext, text: string | null, code: string | null, id: string | null): Promise<PickCandidate[]> {
  const mWhere: SQL[] = [eq(materials.organizationId, ctx.organizationId), eq(materials.status, "active")];
  const pWhere: SQL[] = [eq(products.organizationId, ctx.organizationId), eq(products.status, "active")];
  if (id) {
    mWhere.push(eq(materials.id, id));
    pWhere.push(eq(products.id, id));
  } else if (code) {
    mWhere.push(eq(materials.code, code));
    pWhere.push(eq(products.skuCode, code));
  } else if (text) {
    mWhere.push(...words([materials.name, materials.code, materials.commonName], text));
    pWhere.push(...words([products.name, products.skuCode], text));
  }
  const [m, p] = await Promise.all([
    db.select({ id: materials.id, code: materials.code, name: materials.name }).from(materials).where(and(...mWhere)).orderBy(materials.name).limit(LIMIT),
    db.select({ id: products.id, code: products.skuCode, name: products.name }).from(products).where(and(...pWhere)).orderBy(products.name).limit(LIMIT),
  ]);
  return [...m.map((r) => ({ value: r.id, title: r.name, detail: `material ${r.code}`, code: r.code, codes: [r.code] })), ...p.map((r) => ({ value: r.id, title: r.name, detail: `product ${r.code}`, code: r.code, codes: [r.code] }))].slice(0, LIMIT);
}

function guard(ctx: AuthContext, kind: PickKind) {
  ctx.requireSite(ctx.currentSiteId);
  if (kind === "lot" || kind === "item") ctx.require("inventory.lot.view");
  else if (kind === "container") ctx.require("inventory.container.view");
  else if (kind === "batch") ctx.require("production.batch.view");
}

/** Candidates whose name, number or label code contains every typed word (≥ 2 letters each). */
export async function findPickCandidates(ctx: AuthContext, kind: PickKind, text: string): Promise<PickCandidate[]> {
  guard(ctx, kind);
  const t = String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100).replace(/^BC:[A-Z]{3}:/i, "");
  if (searchTerms(t).length === 0) return [];
  switch (kind) {
    case "lot":
      return lotCandidates(ctx, words([inventoryLots.lotNumber, inventoryLots.supplierLotNumber, inventoryLots.legacyNumber, inventoryLots.supplierName, materials.name, materials.code, products.name, products.skuCode], t));
    case "container":
      return containerCandidates(ctx, [
        sql`(${and(...words([containers.containerNumber], t))} or exists (select 1 from ${containerContents} cc join ${inventoryLots} l on l.id = cc.lot_id left join ${materials} m on m.id = l.material_id left join ${products} p on p.id = l.product_id where cc.container_id = ${containers.id} and cc.qty_base > 0 and ${sql.join(
          searchTerms(t).map((w) => sql`(l.lot_number ilike ${`%${w}%`} or coalesce(m.name, p.name, '') ilike ${`%${w}%`})`),
          sql` and `,
        )}))`,
      ]);
    case "location":
      return locationCandidates(ctx, words([locations.code, locations.name], t));
    case "batch":
      return batchCandidates(ctx, words([batches.batchNumber, products.name], t));
    case "item":
      return itemCandidates(ctx, t, null, null);
  }
}

/**
 * Resolves what a `<ScanOrPick>` field sent: a tapped candidate's id, a label payload (BC:LOT:… for a
 * lot), or a plain record number. Throws a plain "not found" for anything else, including the
 * placeholder text, other sites' records and labels of another kind.
 */
export async function resolvePickRef(ctx: AuthContext, kind: PickKind, raw: string): Promise<PickCandidate> {
  guard(ctx, kind);
  const v = String(raw ?? "").trim();
  if (!v) throw new DomainError("validation", notFoundMessage(kind, false), { field: kind });
  let id: string | null = null;
  let code: string | null = null;
  if (UUID_RE.test(v)) id = v;
  else {
    const c = classifyPickInput(kind, v, [], true);
    if (c.kind === "refused") throw new DomainError("validation", c.message, { field: kind });
    if (c.kind !== "label") throw new DomainError("not_found", notFoundMessage(kind, false), { field: kind });
    code = c.value;
  }
  let hits: PickCandidate[] = [];
  switch (kind) {
    case "lot":
      hits = await lotCandidates(ctx, [id ? eq(inventoryLots.id, id) : eq(inventoryLots.lotNumber, code!)]);
      break;
    case "container":
      hits = await containerCandidates(ctx, [id ? eq(containers.id, id) : eq(containers.containerNumber, code!)]);
      break;
    case "location":
      hits = await locationCandidates(ctx, [id ? eq(locations.id, id) : eq(locations.code, code!)]);
      break;
    case "batch":
      hits = await batchCandidates(ctx, [id ? eq(batches.id, id) : or(eq(batches.batchNumber, code!), eq(batches.outputLotNumber, code!))!]);
      break;
    case "item":
      hits = await itemCandidates(ctx, null, code, id);
      break;
  }
  if (!hits[0]) throw new DomainError("not_found", notFoundMessage(kind, false), { field: kind });
  return hits[0];
}
