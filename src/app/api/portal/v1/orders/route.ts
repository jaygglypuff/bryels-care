import { listPortalOrders, placePortalOrder, type PortalOrderInput } from "@/modules/portal";
import { assertPortalSameOrigin, portalRoute } from "../_portal";

/** GET the customer's orders (portal.order.view). */
export const GET = portalRoute((ctx) => listPortalOrders(ctx));

/**
 * POST a new order (portal.order.create). Body: { lines: [{ productId, qty }], requestedDeliveryOn,
 * customerPoNumber?, shipToAddressId?, note? }. Prices come from the approved price lists only (a
 * price in the body is refused); an `Idempotency-Key` header makes a retry return the first result.
 */
export const POST = portalRoute(async (ctx, req) => {
  assertPortalSameOrigin(req);
  const body = ((await req.json().catch(() => null)) ?? {}) as PortalOrderInput;
  return placePortalOrder(ctx, body, { idempotencyKey: req.headers.get("idempotency-key") });
});
