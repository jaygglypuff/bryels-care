import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { containers, equipment, inventoryBalances, inventoryLots, locations, materials, products, sites, warehouses } from "@/db/schema";
import type { AuthContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { daysUntil, D, fmtDate, fmtDateTime, fmtMass, fmtQty } from "@/lib/qty";
import { invalidScanMessage, parseScan, type ScanType } from "@/lib/scan/payload";
import { limitScanLookup } from "@/lib/rate-limit";
import { activeStationsAt, approvedLabelTemplatesFor, findDocumentByNumber, labelHistory } from "@/modules/documents";
import { activeCountsForLocations, describeBoxForScan, fmtStock, getContainer, getLotDetail, heldLocations, isPastExpiry, resolveScan } from "@/modules/inventory";
import { equipmentAvailability } from "@/modules/masterdata";
import { LOT_TRANSITIONS } from "@/modules/quality";
import { searchEverything, type SearchGroup } from "./search";

/**
 * Scan result card (US-2-13; docs/ux-system.md §5.9): identity, status, risk banner and the
 * actions the server allows, with a reason for each disallowed one. Reads only, no audit.
 * Every lookup is scoped to the user's sites; a record elsewhere looks exactly like a missing one.
 *
 * Actions link to existing pages (lot detail, move, QA decision, label request). Boxes use the
 * W1C box card (describeBoxForScan), locations add the count freeze and QA hold state, and
 * equipment shows the W1D availability (status, calibration, cleaning).
 */

export type ScanAction = { key: string; label: string; href?: string; allowed: boolean; reason?: string; primary?: boolean };
export type ScanFact = [string, string];
export type RiskTone = "q" | "hold" | "exp" | "rej" | "bad" | "warn" | "info";

export type ScanCard =
  | {
      outcome: "found";
      payload: string;
      entity: "lot" | "box" | "location" | "equipment" | "material" | "sku" | "document" | "record";
      caption: string;
      identifier: string;
      title: string;
      subtitle?: string | null;
      siteCode?: string | null;
      status?: { code: string; label?: string } | null;
      expiry?: { date: string; daysLeft: number | null } | null;
      facts: ScanFact[];
      risk?: { tone: RiskTone; title: string; body: string } | null;
      holdings?: { label: string; qty: string; href?: string }[];
      labels?: {
        printed: number;
        reprints: number;
        superseded: { ref: string; printedAt: string | null; reason: string }[];
        mismatch?: string | null;
      } | null;
      actions: ScanAction[];
    }
  | {
      outcome: "not_found" | "not_recognised" | "not_supported" | "rate_limited" | "forbidden";
      payload: string;
      message: string;
      /** ADR-085: "Did you mean…" — lots whose number, supplier lot or item name contains every typed word. */
      matches?: KeywordMatch[];
      /** Universal search (owner review 2026-10-30): typed words grouped by kind (items, lots, batches, orders …). */
      groups?: SearchGroup[];
    };

export type KeywordMatch = { title: string; detail: string; href: string };

const MATCH_LIMIT = 8;
const KEYWORD_STATUS: Record<string, string> = { quarantine: "waiting for check", on_hold: "on hold", rejected: "rejected", expired: "expired", recalled: "recalled", released: "ready to use" };

/**
 * Keyword look-up (ADR-085, consultant review): lots at the caller's sites whose lot number, supplier lot,
 * paper number, material/product name or code, or supplier name contains EVERY typed word (case does
 * not matter). Lots with stock first, then the earliest expiry. Read-only; site-scoped like every look-up.
 */
export async function keywordMatches(ctx: AuthContext, text: string): Promise<KeywordMatch[]> {
  ctx.require("inventory.lot.view");
  const words = text
    .toLowerCase()
    .split(/[\s,;/]+/)
    .map((w) => w.replace(/[%_\\]/g, ""))
    .filter((w) => w.length >= 2)
    .slice(0, 5);
  if (words.length === 0) return [];
  const conds = words.map((w) => {
    const like = `%${w}%`;
    return sql`(${inventoryLots.lotNumber} ilike ${like} or coalesce(${inventoryLots.supplierLotNumber}, '') ilike ${like} or coalesce(${inventoryLots.legacyNumber}, '') ilike ${like} or coalesce(${inventoryLots.supplierName}, '') ilike ${like} or coalesce(${materials.name}, '') ilike ${like} or coalesce(${materials.code}, '') ilike ${like} or coalesce(${products.name}, '') ilike ${like} or coalesce(${products.skuCode}, '') ilike ${like})`;
  });
  const onHand = sql<string>`coalesce((select sum(b.qty_base) from inventory_balances b where b.lot_id = ${inventoryLots.id}), 0)::text`;
  const rows = await db
    .select({
      id: inventoryLots.id,
      lotNumber: inventoryLots.lotNumber,
      status: inventoryLots.qualityStatus,
      expiresOn: inventoryLots.expiresOn,
      baseUom: inventoryLots.baseUom,
      siteId: inventoryLots.siteId,
      name: sql<string>`coalesce(${materials.name}, ${products.name}, '')`,
      onHand,
    })
    .from(inventoryLots)
    .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
    .leftJoin(products, eq(products.id, inventoryLots.productId))
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), inArray(inventoryLots.siteId, ctx.allowedSiteIds), ...conds))
    .orderBy(sql`(${onHand})::numeric > 0 desc`, sql`${inventoryLots.expiresOn} asc nulls last`, inventoryLots.lotNumber)
    .limit(MATCH_LIMIT);
  const multi = ctx.allowedSites.length > 1;
  return rows.map((r) => {
    const qty = D(r.onHand);
    const site = multi ? ctx.allowedSites.find((x) => x.id === r.siteId)?.code : null;
    const parts = [
      qty.gt(0) ? `${fmtStock(r.onHand, r.baseUom)} in stock` : "none left",
      KEYWORD_STATUS[r.status] ?? r.status.replace(/_/g, " "),
      r.expiresOn ? `expires ${fmtDate(r.expiresOn)}` : null,
      site,
    ].filter(Boolean);
    return { title: `${r.name} · lot ${r.lotNumber}`, detail: parts.join(" · "), href: `/inventory/${r.id}` };
  });
}

const STATUS_WORDS: Record<string, string> = { quarantine: "waiting for check", on_hold: "on hold", rejected: "rejected", expired: "expired", recalled: "recalled", released: "released" };
const LABEL_WORD: Record<string, string> = { quarantine: "QUARANTINE", released: "RELEASED", on_hold: "ON HOLD", rejected: "REJECTED", expired: "EXPIRED", recalled: "RECALLED" };

function lotQty(v: string, uom: string) {
  if (uom === "g") return fmtMass(v);
  if (uom === "pcs") return fmtQty(v, "pcs", 0);
  return fmtQty(v, uom, 1);
}

function riskFor(status: string, expired: boolean): { tone: RiskTone; title: string; body: string } | null {
  if (status === "quarantine") return { tone: "q", title: "Waiting for check: not usable yet", body: "It cannot be used in production or shipped until quality checks and releases this lot. Move it only between the waiting-for-check and hold places." };
  if (status === "on_hold") return { tone: "hold", title: "On hold: not usable", body: "It cannot be used in production or shipped. Move it only between the waiting-for-check and hold places until quality decides." };
  if (status === "rejected") return { tone: "rej", title: "Rejected: must not be used or shipped", body: "Keep it in the rejected cage and follow the QA disposal instruction." };
  if (status === "recalled") return { tone: "bad", title: "Recalled: must not be used or shipped", body: "Segregate all remaining stock and tell QA where you found it." };
  if (expired) return { tone: "exp", title: "Expired: not usable", body: "Expired stock is blocked. Move it to a quarantine, hold or rejected location and tell QA." };
  return null;
}

const notFound = (payload: string, what: string, ctx: AuthContext): ScanCard => ({ outcome: "not_found", payload, message: `No ${what} matches this code at ${ctx.currentSite.code}.` });

async function lotCard(ctx: AuthContext, lotId: string, payload: string): Promise<ScanCard> {
  const lot = await getLotDetail(ctx, lotId);
  const site = ctx.allowedSites.find((s) => s.id === lot.siteId);
  const here = lot.siteId === ctx.currentSiteId;
  const elsewhere = `This lot is at ${site?.code ?? "another site"}. Switch site to act on it.`;
  const onHand = lot.balances.reduce((a, b) => a.plus(b.qtyBase), D(0));
  const expired = lot.qualityStatus === "expired" || isPastExpiry(lot.expiresOn);
  const usable = lot.qualityStatus === "released" && !expired;
  const actions: ScanAction[] = [{ key: "open", label: "Open lot", href: `/inventory/${lot.id}`, allowed: true }];

  if (ctx.can("inventory.movement.post")) {
    const reason = !here ? elsewhere : onHand.lte(0) ? "Nothing on hand to move." : undefined;
    actions.push({ key: "move", label: "Move stock", href: `/inventory/${lot.id}/move`, allowed: !reason, reason, primary: !reason });
  } else {
    actions.push({ key: "move", label: "Move stock", allowed: false, reason: "Your role cannot move stock." });
  }

  // Labels: history and the print/reprint actions.
  let labels: Extract<ScanCard, { outcome: "found" }>["labels"] = null;
  if (ctx.can("inventory.label_job.view")) {
    const history = await labelHistory(ctx, "inventory_lot", lot.id);
    const printed = history.filter((j) => j.status === "printed");
    const livePrinted = printed.filter((j) => !j.voidedAt);
    const latest = livePrinted[0];
    labels = {
      printed: printed.filter((j) => j.reprintNo === 0).length,
      reprints: printed.filter((j) => j.reprintNo > 0).length,
      superseded: printed.filter((j) => j.voidedAt).map((j) => ({ ref: `${j.templateCode} · ${j.id.replace(/-/g, "").slice(0, 8).toUpperCase()}${j.reprintNo ? ` · reprint ${j.reprintNo}` : ""}`, printedAt: j.printedAt ? fmtDateTime(j.printedAt) : null, reason: j.voidReason ?? "" })),
      mismatch:
        latest && latest.statusAtPrint && latest.statusAtPrint !== lot.qualityStatus
          ? `The label on this container says ${LABEL_WORD[latest.statusAtPrint] ?? latest.statusAtPrint}; the lot is now ${LABEL_WORD[lot.qualityStatus] ?? lot.qualityStatus}. Print a new label and destroy the old one.`
          : null,
    };
    if (ctx.can("inventory.label_job.create")) {
      let reason: string | undefined;
      if (!here) reason = elsewhere;
      else {
        const appliesTo = lot.itemKind === "product" ? "finished_good" : await materialAppliesTo(lot.materialId);
        const [stations, templates] = await Promise.all([activeStationsAt(db, ctx.organizationId, lot.siteId), approvedLabelTemplatesFor(db, ctx.organizationId, lot.siteId, appliesTo)]);
        if (stations.length === 0) reason = `Label printing isn't set up for ${site?.code} yet. Ask an administrator.`;
        else if (templates.length === 0) reason = `No approved label template for ${appliesTo.replace("_", " ")} lots yet.`;
      }
      actions.push({ key: "label", label: labels.mismatch ? "Print new label" : "Print label", href: `/print/lot-label/${lot.id}`, allowed: !reason, reason });
      if (latest) {
        const r = !ctx.can("documents.reprint.create") ? "Your role cannot reprint labels." : !here ? elsewhere : labels.mismatch ? "The status changed; print a new label instead of a reprint." : undefined;
        actions.push({ key: "reprint", label: "Reprint label", href: `/labels/jobs/${latest.reprintOfId ?? latest.id}`, allowed: !r, reason: r });
      }
    }
  }

  if (ctx.can("quality.disposition.approve")) {
    const possible = Object.values(LOT_TRANSITIONS).some((t) => t.from.includes(lot.qualityStatus));
    actions.push({ key: "qa", label: "QA decision", href: `/quality/lots/${lot.id}`, allowed: possible, reason: possible ? undefined : `No QA decision applies to a ${STATUS_WORDS[lot.qualityStatus] ?? lot.qualityStatus} lot.` });
  }
  if (ctx.can("quality.genealogy.view")) actions.push({ key: "trace", label: "Trace genealogy", href: `/quality/trace?lot=${encodeURIComponent(lot.lotNumber)}`, allowed: true });
  if (!usable) {
    actions.push({ key: "use", label: lot.itemKind === "product" ? "Allocate / ship" : "Issue to production", allowed: false, reason: `Blocked while the lot is ${expired && lot.qualityStatus === "released" ? "expired" : STATUS_WORDS[lot.qualityStatus] ?? lot.qualityStatus}.` });
  }

  const facts: ScanFact[] = [
    ["Item", `${lot.itemName}${lot.itemCode ? ` (${lot.itemCode})` : ""}`],
    ["On hand", lotQty(onHand.toString(), lot.baseUom)],
  ];
  if (lot.supplierLotNumber) facts.push(["Supplier lot", lot.supplierLotNumber]);
  if (lot.batchNumber) facts.push(["Batch", lot.batchNumber]);
  if (lot.receipt) facts.push(["Received", fmtDate(lot.receipt.receivedAt)]);

  return {
    outcome: "found",
    payload,
    entity: "lot",
    caption: lot.itemKind === "product" ? "Finished goods lot" : "Lot",
    identifier: lot.lotNumber,
    title: lot.itemName,
    subtitle: lot.itemCode,
    siteCode: site?.code ?? null,
    status: { code: expired && lot.qualityStatus === "released" ? "expired" : lot.qualityStatus },
    expiry: lot.expiresOn ? { date: fmtDate(lot.expiresOn), daysLeft: daysUntil(lot.expiresOn) } : null,
    facts,
    risk: riskFor(lot.qualityStatus, expired),
    holdings: lot.balances.map((b) => ({ label: `${b.code} · ${b.name}`, qty: lotQty(b.qtyBase, lot.baseUom) })),
    labels,
    actions,
  };
}

async function materialAppliesTo(materialId: string | null) {
  if (!materialId) return "material";
  const [m] = await db.select({ kind: materials.materialKind }).from(materials).where(eq(materials.id, materialId)).limit(1);
  return m?.kind === "intermediate" ? "wip" : "material";
}

async function findLotId(ctx: AuthContext, value: string) {
  const [lot] = await db
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.organizationId, ctx.organizationId), eq(inventoryLots.lotNumber, value), inArray(inventoryLots.siteId, ctx.allowedSiteIds)))
    .limit(1);
  return lot?.id ?? null;
}

async function locationCard(ctx: AuthContext, value: string, payload: string): Promise<ScanCard> {
  if (!ctx.can("masterdata.location.view")) return { outcome: "forbidden", payload, message: "Your role cannot look up locations." };
  const rows = await db
    .select({ l: locations, wh: warehouses.code })
    .from(locations)
    .innerJoin(warehouses, eq(warehouses.id, locations.warehouseId))
    .where(and(inArray(locations.siteId, ctx.allowedSiteIds), eq(locations.code, value)));
  // Location codes are unique per site: prefer the current site.
  const row = rows.find((r) => r.l.siteId === ctx.currentSiteId) ?? (rows.length === 1 ? rows[0] : null);
  if (!row) return notFound(payload, "location", ctx);
  const l = row.l;
  const site = ctx.allowedSites.find((s) => s.id === l.siteId);
  const here = l.siteId === ctx.currentSiteId;
  const holdings = here
    ? await db
        .select({ lotId: inventoryLots.id, lotNumber: inventoryLots.lotNumber, qty: inventoryBalances.qtyBase, uom: inventoryLots.baseUom, status: inventoryLots.qualityStatus, item: sql<string>`coalesce(${materials.name}, ${products.name})` })
        .from(inventoryBalances)
        .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryBalances.lotId))
        .leftJoin(materials, eq(materials.id, inventoryLots.materialId))
        .leftJoin(products, eq(products.id, inventoryLots.productId))
        .where(and(eq(inventoryBalances.locationId, l.id), gt(inventoryBalances.qtyBase, "0")))
        .orderBy(inventoryLots.lotNumber)
        .limit(20)
    : [];
  // Count freeze (W1C, V-FREEZE) and location QA hold (W1B): both block moves in and out.
  const [count] = await activeCountsForLocations(db, [l.id]);
  const hold = (await heldLocations(db, l.siteId)).find((h) => h.locationId === l.id);
  const [boxes] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(containers)
    .where(and(eq(containers.currentLocationId, l.id), inArray(containers.status, ["open", "sealed"])));
  const elsewhere = `This location is at ${site?.code}. Switch site first.`;
  const actions: ScanAction[] = [
    { key: "lots", label: "What is here", href: `/inventory/locations/${l.id}`, allowed: here, reason: here ? undefined : elsewhere },
  ];
  if (ctx.can("inventory.movement.post")) {
    const reason = !here ? elsewhere : !l.isActive ? "Location is inactive." : count ? `Frozen by stock count ${count.countNumber}.` : hold ? `Blocked by QA hold ${hold.holdNumber}.` : undefined;
    actions.push({ key: "move_here", label: "Move stock here", href: `/inventory/move?to=${l.id}`, allowed: !reason, reason });
  }
  if (count && here && ctx.can("inventory.stock_count.submit")) actions.push({ key: "count", label: `Count ${count.countNumber}`, href: `/inventory/counts/${count.countId}`, allowed: true, primary: true });
  if (ctx.can("inventory.label_job.create")) {
    let reason: string | undefined = here ? undefined : `This location is at ${site?.code}. Switch site first.`;
    if (!reason) {
      const [stations, templates] = await Promise.all([activeStationsAt(db, ctx.organizationId, l.siteId), approvedLabelTemplatesFor(db, ctx.organizationId, l.siteId, "location")]);
      if (stations.length === 0) reason = `Label printing isn't set up for ${site?.code} yet. Ask an administrator.`;
      else if (templates.length === 0) reason = "No approved location label template yet.";
    }
    actions.push({ key: "label", label: "Print location label", href: `/labels/new?entityType=location&entityId=${l.id}`, allowed: !reason, reason });
  }
  return {
    outcome: "found",
    payload,
    entity: "location",
    caption: "Location",
    identifier: l.code,
    title: l.name,
    subtitle: `${row.wh} · ${l.kind}`,
    siteCode: site?.code ?? null,
    status: l.isActive ? null : { code: "cancelled", label: "Inactive" },
    facts: [
      ["Kind", l.kind],
      ["Warehouse", row.wh],
      ["Boxes here", String(Number(boxes?.n ?? 0))],
      ["Count in progress", count?.countNumber ?? "None"],
    ],
    risk: count
      ? { tone: "warn", title: `Frozen by stock count ${count.countNumber}`, body: "Nothing can move in or out of this location until the count is posted or cancelled." }
      : hold
        ? { tone: "hold", title: `Under QA hold ${hold.holdNumber}`, body: "No stock may be moved into this location; stock here may only go to a quarantine, hold or rejected location." }
        : ["quarantine", "hold", "rejected"].includes(l.kind) ? { tone: l.kind === "rejected" ? "rej" : l.kind === "hold" ? "hold" : "q", title: `${l.kind === "rejected" ? "Rejected goods" : l.kind === "hold" ? "QA hold" : "Quarantine"} location`, body: "Stock here is not usable until QA decides." } : null,
    holdings: here
      ? holdings.map((h) => ({ label: `${h.lotNumber} · ${h.item} · ${LABEL_WORD[h.status] ?? h.status}`, qty: lotQty(h.qty, h.uom), href: `/inventory/${h.lotId}` }))
      : undefined,
    actions,
  };
}

async function boxCard(ctx: AuthContext, value: string, payload: string): Promise<ScanCard> {
  if (!ctx.can("inventory.container.view")) return { outcome: "forbidden", payload, message: "Your role cannot look up boxes." };
  const c = await describeBoxForScan(ctx, value);
  if (!c) return notFound(payload, "box", ctx);
  const box = await getContainer(ctx, c.id);
  const site = ctx.allowedSites.find((s) => s.id === box.siteId);
  const here = box.siteId === ctx.currentSiteId;
  const lotStatuses = [...new Set(box.contents.map((x) => x.qualityStatus))];
  const risk = lotStatuses.length === 1 ? riskFor(lotStatuses[0], false) : lotStatuses.length > 1 ? { tone: "warn" as const, title: "Mixed lot statuses", body: "This box holds lots with different QA statuses; check each lot before use." } : null;
  return {
    outcome: "found",
    payload,
    entity: "box",
    caption: "Box",
    identifier: c.title,
    title: c.subtitle,
    subtitle: box.locationCode ? `At ${box.locationCode}` : null,
    siteCode: site?.code ?? null,
    status: lotStatuses.length === 1 ? { code: lotStatuses[0] } : { code: box.status === "sealed" || box.status === "open" ? "released" : "cancelled", label: `Box ${box.status}` },
    facts: c.facts,
    risk: c.warnings.length ? { tone: "warn", title: c.warnings[0], body: c.warnings.slice(1).join(" ") || "Resolve this before moving the box." } : risk,
    holdings: box.contents.map((x) => ({ label: `${x.lotNumber} · ${x.itemName} · ${LABEL_WORD[x.qualityStatus] ?? x.qualityStatus}`, qty: lotQty(x.qtyBase, x.baseUom), href: `/inventory/${x.lotId}` })),
    actions: [
      { key: "open", label: "Open box", href: c.href, allowed: true },
      ...c.allowedActions.map((a) => ({ ...a, allowed: a.allowed && here, reason: !here ? `This box is at ${site?.code}. Switch site first.` : a.reason, primary: a.key === "move" && a.allowed && here })),
    ],
  };
}

async function equipmentCard(ctx: AuthContext, value: string, payload: string): Promise<ScanCard> {
  if (!ctx.can("masterdata.equipment.view")) return { outcome: "forbidden", payload, message: "Your role cannot look up equipment." };
  const rows = await db
    .select({ id: equipment.id, siteId: equipment.siteId, siteCode: sites.code })
    .from(equipment)
    .innerJoin(sites, eq(sites.id, equipment.siteId))
    .where(and(eq(equipment.organizationId, ctx.organizationId), inArray(equipment.siteId, ctx.allowedSiteIds), eq(equipment.code, value)));
  const row = rows.find((r) => r.siteId === ctx.currentSiteId) ?? (rows.length === 1 ? rows[0] : null);
  if (!row) return notFound(payload, "equipment", ctx);
  const av = await equipmentAvailability(ctx, row.id);
  const e = av.equipment;
  return {
    outcome: "found",
    payload,
    entity: "equipment",
    caption: "Equipment",
    identifier: e.code,
    title: e.name,
    subtitle: e.kind.replace(/_/g, " "),
    siteCode: row.siteCode,
    status: { code: av.usable ? "released" : "on_hold", label: av.usable ? (av.override ? "Usable (override)" : "Available") : "Not usable" },
    facts: [
      ["Status", e.status.replace(/_/g, " ")],
      ["Calibration due", e.calibrationDueDate ?? "—"],
      ["Maintenance due", e.maintenanceDueDate ?? "—"],
      ["Cleaning", e.cleaningStatus.replace(/_/g, " ")],
    ],
    risk: av.usable
      ? av.warnings.length
        ? { tone: "warn", title: "Usable with a warning", body: av.warnings.map((w) => w.detail).join(" · ") }
        : null
      : { tone: "bad", title: "Do not use this equipment", body: av.blockingReasons.map((r) => r.detail).join(" · ") || "Blocked." },
    actions: [{ key: "open", label: "Open equipment record", href: `/masterdata/equipment/${e.id}`, allowed: true, primary: true }],
  };
}

async function materialCard(ctx: AuthContext, value: string, payload: string): Promise<ScanCard> {
  if (!ctx.can("masterdata.material.view")) return { outcome: "forbidden", payload, message: "Your role cannot look up materials." };
  const [m] = await db.select().from(materials).where(and(eq(materials.organizationId, ctx.organizationId), eq(materials.code, value))).limit(1);
  if (!m) return notFound(payload, "material", ctx);
  const counts = await lotCounts(ctx, eq(inventoryLots.materialId, m.id));
  return {
    outcome: "found",
    payload,
    entity: "material",
    caption: "Material",
    identifier: m.code,
    title: m.name,
    subtitle: m.inciName,
    siteCode: null,
    facts: [["Kind", m.materialKind.replace("_", " ")], ["Base unit", m.baseUom], ...counts],
    actions: [{ key: "lots", label: `Lots at ${ctx.currentSite.code}`, href: `/inventory?q=${encodeURIComponent(m.code)}`, allowed: true, primary: true }],
  };
}

async function skuCard(ctx: AuthContext, value: string, payload: string): Promise<ScanCard> {
  if (!ctx.can("masterdata.product.view")) return { outcome: "forbidden", payload, message: "Your role cannot look up products." };
  const [p] = await db.select().from(products).where(and(eq(products.organizationId, ctx.organizationId), eq(products.skuCode, value))).limit(1);
  if (!p) return notFound(payload, "SKU", ctx);
  const counts = await lotCounts(ctx, eq(inventoryLots.productId, p.id));
  return {
    outcome: "found",
    payload,
    entity: "sku",
    caption: "SKU",
    identifier: p.skuCode,
    title: p.name,
    subtitle: p.family,
    facts: [["Units per box", String(p.unitsPerBox)], ...counts],
    actions: [{ key: "lots", label: `Lots at ${ctx.currentSite.code}`, href: `/inventory?q=${encodeURIComponent(p.skuCode)}`, allowed: true, primary: true }],
  };
}

async function lotCounts(ctx: AuthContext, cond: ReturnType<typeof eq>): Promise<ScanFact[]> {
  const rows = await db
    .select({ status: inventoryLots.qualityStatus, n: sql<number>`count(distinct ${inventoryLots.id})::int` })
    .from(inventoryLots)
    .innerJoin(inventoryBalances, and(eq(inventoryBalances.lotId, inventoryLots.id), gt(inventoryBalances.qtyBase, "0")))
    .where(and(cond, eq(inventoryLots.siteId, ctx.currentSiteId)))
    .groupBy(inventoryLots.qualityStatus);
  if (rows.length === 0) return [[`Stock at ${ctx.currentSite.code}`, "No lots with stock"]];
  return rows.map((r) => [`Lots ${STATUS_WORDS[r.status] ?? r.status}`, String(r.n)] as ScanFact);
}

async function documentCard(ctx: AuthContext, value: string, payload: string): Promise<ScanCard | null> {
  if (!ctx.can("documents.generated_document.view")) return null;
  const d = await findDocumentByNumber(ctx, value);
  if (!d) return null;
  return {
    outcome: "found",
    payload,
    entity: "document",
    caption: "Document",
    identifier: d.documentNumber,
    title: d.documentKind.replace(/_/g, " "),
    subtitle: d.reprintNo ? `Reprint ${d.reprintNo}` : `Rev ${d.recordRevisionNo}`,
    status: { code: d.status === "ready" ? "released" : d.status === "void" ? "cancelled" : "pending", label: d.status },
    facts: [
      ["Generated", fmtDateTime(d.generatedAt)],
      ["Watermark", d.watermark ?? "—"],
    ],
    risk: d.status === "superseded" || d.status === "void" ? { tone: "warn", title: `This document is ${d.status}`, body: "Do not use this printed copy; get the current one." } : null,
    actions:
      d.sourceEntityType === "batch"
        ? // Wave 2 W2D: a BMR / paper page QR opens the batch (after sign-in and batch permission, A-RPT-26).
          [
            { key: "open", label: "Open batch", href: `/production/${d.sourceEntityId}`, allowed: true, primary: true },
            { key: "document", label: "Open document record", href: `/documents/${d.id}`, allowed: true },
          ]
        : [{ key: "open", label: "Open document record", href: `/documents/${d.id}`, allowed: true, primary: true }],
  };
}

const NOT_TRACKED: Partial<Record<ScanType, string>> = {};

/** Typed words: lots (ADR-085) plus every other group the caller may see (universal search). */
async function wordsResult(ctx: AuthContext, raw: string, payload: string): Promise<ScanCard> {
  const text = raw.trim();
  const matches = await keywordMatches(ctx, text);
  const groups = await searchEverything(ctx, text, matches);
  if (!groups.length) return { outcome: "not_found", payload, message: `Nothing matches "${text}". Try fewer words, part of a name, or part of a lot, batch or order number.` };
  const n = groups.reduce((a, g) => a + g.hits.length, 0);
  return { outcome: "not_found", payload, message: `${n} ${n === 1 ? "result" : "results"} for "${text}". Tap one to open it.`, matches, groups };
}

/** Resolves one scan into a card. Rate limited per user (setting platform.rate_limits, 120 per minute) in the shared store (US-1-25). */
export async function resolveScanCard(ctx: AuthContext, raw: string): Promise<ScanCard> {
  ctx.require("inventory.lot.view");
  const p = parseScan(raw);
  const payload = p.kind === "typed" ? p.payload : p.kind === "untyped" ? p.value : p.input;
  if (!(await limitScanLookup(ctx.organizationId, ctx.userId)).allowed) return { outcome: "rate_limited", payload, message: "Too many look-ups in a minute. Wait a moment, then scan again." };
  if (p.kind === "invalid") {
    // Typed words ("coconut oil") are not a label: search by keyword instead of refusing (ADR-085).
    if (p.reason === "grammar" && !String(raw).trim().toUpperCase().startsWith("BC:")) {
      return await wordsResult(ctx, String(raw), payload);
    }
    return { outcome: "not_recognised", payload, message: invalidScanMessage(p) };
  }

  try {
    if (p.kind === "typed") {
      switch (p.type) {
        case "LOT": {
          const id = await findLotId(ctx, p.value);
          return id ? await lotCard(ctx, id, payload) : notFound(payload, "lot", ctx);
        }
        case "LOC":
          return await locationCard(ctx, p.value, payload);
        case "BOX":
          return await boxCard(ctx, p.value, payload);
        case "EQP":
          return await equipmentCard(ctx, p.value, payload);
        case "MAT":
          return await materialCard(ctx, p.value, payload);
        case "SKU":
          return await skuCard(ctx, p.value, payload);
        case "DOC":
          return (await documentCard(ctx, p.value, payload)) ?? { outcome: "not_found", payload, message: "No document matches this code at your sites." };
        default:
          return { outcome: "not_supported", payload, message: NOT_TRACKED[p.type] ?? "This label type cannot be looked up yet." };
      }
    }
    // Untyped manual entry: lot first, then documents, then the numbered records the MVP search knows.
    const lotId = await findLotId(ctx, p.value);
    if (lotId) return await lotCard(ctx, lotId, payload);
    const doc = await documentCard(ctx, p.value, payload);
    if (doc) return doc;
    const r = await resolveScan(ctx, p.value);
    if (r.ok) return { outcome: "found", payload, entity: "record", caption: r.label.split(" ")[0], identifier: p.value, title: r.label, facts: [], actions: [{ key: "open", label: `Open ${r.label.toLowerCase()}`, href: r.href, allowed: true, primary: true }] };
    return await wordsResult(ctx, String(raw), payload);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") return notFound(payload, "record", ctx);
    throw e;
  }
}
