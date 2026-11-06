import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUPERSEDED_LINKS, currentHref, notificationHref } from "@/lib/record-links";

/**
 * Superseded screens (docs/LEGACY_SCREENS.md) keep their old address alive as a server redirect to the screen
 * that does the job now. Each page module is called with its params and must redirect to the replacement.
 */
class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const ID = "01a18abf-6191-7ac6-8701-ea7a8b336232";
const APP = join(__dirname, "..", "..", "src", "app", "(app)");

type PageArgs = { params?: Record<string, string>; searchParams?: Record<string, string> };
async function landing(modulePath: string, args: PageArgs = {}): Promise<string> {
  const mod = (await import(modulePath)) as { default: (a: { params: Promise<unknown>; searchParams: Promise<unknown> }) => unknown };
  try {
    await mod.default({ params: Promise.resolve(args.params ?? {}), searchParams: Promise.resolve(args.searchParams ?? {}) });
  } catch (e) {
    if (e instanceof Redirected) return e.to;
    throw e;
  }
  throw new Error(`${modulePath} rendered instead of redirecting`);
}

describe("superseded screens redirect to the current one", () => {
  beforeEach(() => vi.resetModules());

  it("/inventory/[lotId]/move → Move stock with the lot filled in", async () => {
    expect(await landing("@/app/(app)/inventory/[lotId]/move/page", { params: { lotId: ID } })).toBe(`/inventory/move?lot=${ID}`);
  });

  it("/masterdata/suppliers → the one supplier list (search and filters kept)", async () => {
    expect(await landing("@/app/(app)/masterdata/suppliers/page")).toBe("/procurement/suppliers");
    expect(await landing("@/app/(app)/masterdata/suppliers/page", { searchParams: { q: "laguna oleo", all: "1", status: "approved" } })).toBe("/procurement/suppliers?q=laguna+oleo&all=1");
    expect(await landing("@/app/(app)/masterdata/suppliers/page", { searchParams: { deleted: "1" } })).toBe("/procurement/suppliers?deleted=1");
  });

  it("/quality/check (batches only) → the QA queue (batches and deliveries)", async () => {
    expect(await landing("@/app/(app)/quality/check/page")).toBe("/quality");
  });

  // Round 4 (UX re-audit C #5): /masterdata/recipes is the plain recipe list now, no longer an alias of the advanced list.
  it("older aliases still redirect: /inventory/lots, /procurement/expected/[poId], /admin", async () => {
    expect(await landing("@/app/(app)/inventory/lots/page")).toBe("/inventory");
    expect(await landing("@/app/(app)/procurement/expected/[poId]/page", { params: { poId: ID } })).toBe(`/inventory/receive?po=${ID}`);
    expect(await landing("@/app/(app)/admin/page")).toBe("/admin/users");
  });

  it("/production/board (old statuses) → the board view of the production orders (ADR-115)", async () => {
    expect(await landing("@/app/(app)/production/board/page")).toBe("/production/orders?view=board");
    expect(await landing("@/app/(app)/production/board/page", { searchParams: { lineId: ID, from: "2026-11-01" } })).toBe("/production/orders?view=board");
  });

  it("/production/staging/[batchId] (Lots and sheets) → the batch record, which prints the sheets (ADR-115)", async () => {
    expect(await landing("@/app/(app)/production/staging/[batchId]/page", { params: { batchId: ID } })).toBe(`/production/${ID}`);
  });

  it("Problems & alerts sends its former decision and message tabs to To approve and Messages", () => {
    // The page reads the database, so its first lines are checked instead of rendering it.
    const src = readFileSync(join(APP, "action-centre", "page.tsx"), "utf8");
    expect(src).toMatch(/if \(sp\.tab === "approvals"\) redirect\("\/approvals"\);/);
    expect(src).toMatch(/if \(sp\.tab === "alerts"\) redirect\("\/notifications"\);/);
    expect(src).toMatch(/k\.tab === "approvals"\)\) redirect\("\/approvals"\)/);
    expect(src).not.toMatch(/listMyNotifications|TAB_TEXT|tab === "alerts" \?/);
  });
});

describe("links stored before the change open the current screen (currentHref)", () => {
  it.each([
    ["/action-centre?tab=approvals", "/approvals"],
    ["/action-centre?kind=x&tab=approvals", "/approvals"],
    ["/action-centre?tab=alerts", "/notifications"],
    [`/inventory/${ID}/move`, `/inventory/move?lot=${ID}`],
    [`/inventory/lots/${ID}`, `/inventory/${ID}`],
    ["/masterdata/suppliers", "/procurement/suppliers"],
    ["/masterdata/suppliers?deleted=1", "/procurement/suppliers?deleted=1"],
    [`/production/work-orders/${ID}`, `/production/orders/${ID}`],
    ["/production/board", "/production/orders?view=board"],
    ["/production/board?lineId=x", "/production/orders?view=board"],
    [`/production/staging/${ID}`, `/production/${ID}`],
    ["/quality/check", "/quality"],
  ])("%s → %s", (from, to) => {
    expect(currentHref(from)).toBe(to);
  });

  it("leaves current screens and records with their own page alone", () => {
    for (const keep of ["/action-centre", "/action-centre?tab=sync", `/masterdata/suppliers/${ID}`, `/inventory/${ID}`, "/inventory/lots/expiry", `/quality/batches/${ID}`, `/quality/check/${ID}`, "/approvals"]) expect(currentHref(keep)).toBe(keep);
  });

  it("notifications with an old stored link open the replacement", () => {
    expect(notificationHref({ entityType: "work_order", entityId: ID, link: `/production/work-orders/${ID}` })).toBe(`/production/orders/${ID}`);
    expect(notificationHref({ entityType: "supplier", entityId: ID, link: null })).toBe(`/procurement/suppliers/${ID}`);
  });

  it("every replacement is a screen that exists", () => {
    expect(SUPERSEDED_LINKS.length).toBeGreaterThanOrEqual(6);
    const page = (...segs: string[]) => existsSync(join(APP, ...segs, "page.tsx"));
    expect(page("approvals")).toBe(true);
    expect(page("notifications")).toBe(true);
    expect(page("inventory", "move")).toBe(true);
    expect(page("inventory", "[lotId]")).toBe(true);
    expect(page("procurement", "suppliers")).toBe(true);
    expect(page("quality")).toBe(true);
    expect(page("procurement", "suppliers", "[id]")).toBe(true);
    expect(page("production", "orders", "[workOrderId]")).toBe(true);
    expect(page("production", "orders")).toBe(true);
    expect(page("production", "[batchId]")).toBe(true);
  });
});
