import { describe, expect, it } from "vitest";
import { orderDaysLate } from "@/modules/sales/late";

describe("orderDaysLate", () => {
  const today = "2026-10-30";
  it("counts whole days past the requested delivery date for open orders", () => {
    expect(orderDaysLate({ status: "confirmed", requestedDeliveryOn: "2026-10-10" }, today)).toBe(20);
    expect(orderDaysLate({ status: "partially_shipped", requestedDeliveryOn: "2026-10-29" }, today)).toBe(1);
  });
  it("is not late on the delivery day itself or before it", () => {
    expect(orderDaysLate({ status: "allocated", requestedDeliveryOn: today }, today)).toBe(0);
    expect(orderDaysLate({ status: "draft", requestedDeliveryOn: "2026-11-02" }, today)).toBe(0);
  });
  it("never flags shipped, invoiced, closed or cancelled orders, or orders without a date", () => {
    for (const status of ["shipped", "invoiced", "closed", "cancelled"]) expect(orderDaysLate({ status, requestedDeliveryOn: "2026-10-01" }, today)).toBe(0);
    expect(orderDaysLate({ status: "confirmed", requestedDeliveryOn: null }, today)).toBe(0);
  });
});
