/**
 * authz.portal.tenant_isolation at the HTTP boundary (W4E, docs/permissions-matrix.md §8): the portal
 * routes `/api/portal/v1/*` accept only the portal cookie; the staff `/api/v1` routes reject the portal
 * cookie with 401; a staff cookie opens nothing in the portal API; another customer's ids answer 404.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { salesOrders, users } from "@/db/schema";
import { createSessionRecord } from "@/lib/auth/session-store";
import { GET as staffCustomerGET } from "@/app/api/v1/sales/customers/[customerId]/route";
import { GET as catalogueGET } from "@/app/api/portal/v1/catalogue/route";
import { GET as ordersGET, POST as ordersPOST } from "@/app/api/portal/v1/orders/route";
import { GET as orderGET } from "@/app/api/portal/v1/orders/[id]/route";
import { GET as documentsGET } from "@/app/api/portal/v1/documents/route";
import { resetTestDatabase } from "../../support/db";
import { setTestCookies } from "../../support/next-headers";
import { inDays, productId } from "../../support/w3d";
import { loadW4e, portalSignIn, type W4e } from "../../support/w4e";

let w: W4e;
let joyToken: string;
let carlaToken: string;
let staffToken: string;

beforeAll(async () => {
  await resetTestDatabase();
  w = await loadW4e();
  joyToken = (await portalSignIn("portal.mabuhay@bryels-care.test")).token;
  carlaToken = (await portalSignIn("portal.salon@bryels-care.test")).token;
  const [staff] = await db.select().from(users).where(eq(users.email, "sales@bryels-care.test"));
  staffToken = (await createSessionRecord({ userId: staff.id })).token;
});
afterEach(() => setTestCookies({}));

const req = (path: string, cookie: string | null, init: RequestInit = {}) =>
  new Request(`http://localhost:3405${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), host: "localhost:3405", ...(init.headers as Record<string, string> | undefined) } });
const params = <P,>(p: P) => ({ params: Promise.resolve(p) });

describe("portal API", () => {
  it("401 without a portal cookie, and 401 with only the staff cookie", async () => {
    expect((await ordersGET(req("/api/portal/v1/orders", null), params({}))).status).toBe(401);
    const r = await ordersGET(req("/api/portal/v1/orders", `bc_session=${staffToken}`), params({}));
    expect(r.status).toBe(401);
    expect((await r.json()).error.code).toBe("UNAUTHENTICATED");
    // A staff token placed in the portal cookie name is still not a portal session.
    expect((await catalogueGET(req("/api/portal/v1/catalogue", `bc_portal=${staffToken}`), params({}))).status).toBe(401);
  });

  it("200 with the portal cookie: own orders, catalogue and documents only", async () => {
    const r = await ordersGET(req("/api/portal/v1/orders", `bc_portal=${joyToken}`), params({}));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const body = await r.json();
    const ids: string[] = body.data.map((o: { id: string }) => o.id);
    const rows = await db.select({ id: salesOrders.id, customerId: salesOrders.customerId }).from(salesOrders);
    expect(new Set(rows.filter((x) => ids.includes(x.id)).map((x) => x.customerId))).toEqual(new Set([w.mabuhayId]));
    const cat = await (await catalogueGET(req("/api/portal/v1/catalogue", `bc_portal=${joyToken}`), params({}))).json();
    expect(cat.data.find((i: { sku: string }) => i.sku === "ACS-135").priceBreaks[0].unitAmount).toBe("72.50");
    const docs = await (await documentsGET(req("/api/portal/v1/documents", `bc_portal=${joyToken}`), params({}))).json();
    expect(docs.ok).toBe(true);
  });

  it("another customer's order id answers 404 with no fields", async () => {
    const [salonOrder] = await db.select().from(salesOrders).where(eq(salesOrders.customerId, w.salonId)).limit(1);
    const r = await orderGET(req(`/api/portal/v1/orders/${salonOrder.id}`, `bc_portal=${joyToken}`), params({ id: salonOrder.id }));
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(JSON.stringify(body)).not.toContain(salonOrder.orderNumber);
    expect((await orderGET(req(`/api/portal/v1/orders/${salonOrder.id}`, `bc_portal=${carlaToken}`), params({ id: salonOrder.id }))).status).toBe(200);
  });

  it("POST places an order through the internal machine; a foreign Origin is refused; a body price is refused", async () => {
    const acs = await productId("ACS-135");
    const body = JSON.stringify({ lines: [{ productId: acs, qty: "48" }], requestedDeliveryOn: inDays(9) });
    const bad = await ordersPOST(req("/api/portal/v1/orders", `bc_portal=${joyToken}`, { method: "POST", body, headers: { "content-type": "application/json", origin: "https://evil.example" } }), params({}));
    expect(bad.status).toBe(403);
    const priced = JSON.stringify({ lines: [{ productId: acs, qty: "48", unitPrice: "1.00" }], requestedDeliveryOn: inDays(9) });
    expect((await ordersPOST(req("/api/portal/v1/orders", `bc_portal=${joyToken}`, { method: "POST", body: priced, headers: { "content-type": "application/json" } }), params({}))).status).toBe(422);
    const key = crypto.randomUUID();
    const ok = await ordersPOST(req("/api/portal/v1/orders", `bc_portal=${joyToken}`, { method: "POST", body, headers: { "content-type": "application/json", "idempotency-key": key } }), params({}));
    expect(ok.status).toBe(200);
    const placed = (await ok.json()).data;
    expect(placed.status).toBe("confirmed");
    const again = await (await ordersPOST(req("/api/portal/v1/orders", `bc_portal=${joyToken}`, { method: "POST", body, headers: { "content-type": "application/json", "idempotency-key": key } }), params({}))).json();
    expect(again.data.orderId).toBe(placed.orderId);
  });
});

describe("staff API rejects the portal cookie", () => {
  it("/api/v1 answers 401 to a request carrying only the portal cookie; the staff cookie works (control)", async () => {
    setTestCookies({ bc_portal: joyToken });
    const r = await staffCustomerGET(req(`/api/v1/sales/customers/${w.mabuhayId}`, `bc_portal=${joyToken}`), params({ customerId: w.mabuhayId }));
    expect(r.status).toBe(401);
    setTestCookies({ bc_session: joyToken });
    expect((await staffCustomerGET(req(`/api/v1/sales/customers/${w.mabuhayId}`, null), params({ customerId: w.mabuhayId }))).status).toBe(401);
    setTestCookies({ bc_session: staffToken });
    expect((await staffCustomerGET(req(`/api/v1/sales/customers/${w.mabuhayId}`, null), params({ customerId: w.mabuhayId }))).status).toBe(200);
  });
});
