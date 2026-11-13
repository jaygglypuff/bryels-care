/**
 * ADR-132 §2 (round 5 leftovers, A report #6): many messages of the same kind and screen on one day collapse into one
 * row ("12 lots are ready to put away" → the put-away list) that expands to each message.
 */
import { describe, expect, it } from "vitest";
import { GROUP_FROM, groupMessages, targetScreen } from "@/app/(app)/notifications/group";

let n = 0;
const msg = (kind: string, link: string | null, at = "2026-11-13T02:00:00Z", extra: Partial<{ readAt: Date; resolvedAt: Date; acknowledgedAt: Date }> = {}) => ({
  id: `m${++n}`,
  kind,
  title: `${kind} ${n}`,
  link,
  createdAt: new Date(at),
  readAt: extra.readAt ?? null,
  acknowledgedAt: extra.acknowledgedAt ?? null,
  resolvedAt: extra.resolvedAt ?? null,
});
const lotId = () => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

describe("targetScreen", () => {
  it("drops the record id, the query and the hash", () => {
    expect(targetScreen("/production/orders/0b6f0f9e-2a4c-4b6f-9a51-0c2b0b5a1e11")).toBe("/production/orders");
    expect(targetScreen("/procurement/orders/0b6f0f9e-2a4c-4b6f-9a51-0c2b0b5a1e11#delivery-problems")).toBe("/procurement/orders");
    expect(targetScreen("/inventory/receive?po=1")).toBe("/inventory/receive");
    expect(targetScreen(null)).toBe("");
  });
});

describe("groupMessages", () => {
  it("12 put-away messages of one day are one row that opens the put-away list", () => {
    const list = Array.from({ length: 12 }, () => msg("inventory.lot.ready_to_put_away", "/inventory/receive/put-away"));
    const rows = groupMessages(list);
    expect(rows).toHaveLength(1);
    const g = rows[0];
    expect(g.type).toBe("group");
    if (g.type !== "group") return;
    expect(g.title).toBe("12 lots are ready to put away");
    expect(g.list).toBe("/inventory/receive/put-away");
    expect(g.messages).toHaveLength(12);
    expect(g.unread).toBe(12);
  });

  it(`fewer than ${GROUP_FROM} stay single rows`, () => {
    const rows = groupMessages([msg("handoff.pick", "/sales/picking"), msg("handoff.pick", "/sales/picking")]);
    expect(rows.map((r) => r.type)).toEqual(["one", "one"]);
  });

  it("does not group across days, across states or across kinds", () => {
    const rows = groupMessages([
      msg("handoff.pick", "/sales/picking", "2026-11-13T02:00:00Z"),
      msg("handoff.pick", "/sales/picking", "2026-11-13T03:00:00Z"),
      msg("handoff.pick", "/sales/picking", "2026-11-12T03:00:00Z"),
      msg("handoff.pick", "/sales/picking", "2026-11-13T04:00:00Z", { resolvedAt: new Date() }),
      msg("handoff.dispatch", "/sales/shipments/x"),
    ]);
    expect(rows.every((r) => r.type === "one")).toBe(true);
  });

  it("unknown kinds group by the screen they open and keep the list order", () => {
    const first = msg("fyi.other", "/admin/diagnostics");
    const ids = [lotId(), lotId(), lotId()];
    const rows = groupMessages([first, ...ids.map((_, i) => msg("quality.capa.assigned", `/quality/capa/0b6f0f9e-2a4c-4b6f-9a51-0c2b0b5a1e1${i}`))]);
    expect(rows[0]).toEqual({ type: "one", message: first });
    expect(rows[1].type).toBe("group");
    if (rows[1].type === "group") {
      expect(rows[1].list).toBe("/quality/capa");
      expect(rows[1].title).toBe("3 messages like this");
      expect(rows[1].newest).toMatch(/^quality.capa.assigned /);
    }
  });

  it("weighing and step checks share one row that opens the checker's list", () => {
    const rows = groupMessages([msg("handoff.weighing_check", "/production/checks"), msg("handoff.step_check", "/production/checks"), msg("handoff.weighing_check", "/production/checks")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type === "group" && rows[0].title).toBe("3 checks wait for you");
  });
});
