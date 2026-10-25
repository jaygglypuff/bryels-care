import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "@/db/client";
import { creditNotes, financeStateTransitions, financialPostings, invoices, paymentApplications, paymentRecords, supplierBills, users } from "@/db/schema";
import { seedW4b } from "@/db/seeds/w4b";
import { listInvoices, receivablesSummary } from "@/modules/finance";
import { resetTestDatabase } from "../../support/db";
import { customMigration } from "../../support/custom-sql";
import { loadW4b, type W4b } from "../../support/w4b";

/**
 * The W4B demo seed (src/db/seeds/w4b.ts) on a fresh test database: the finance documents are skipped
 * inside vitest by src/db/seed.ts (tests build their own), so this file loads them explicitly and checks
 * that every projection reconciles with the ledger, and that the ledgers are append-only.
 */
let w: W4b;

async function refused(p: Promise<unknown>) {
  const e = (await p.then(() => null).catch((x) => x)) as { message?: string; cause?: { message?: string } } | null;
  expect(e, "the statement must fail").toBeTruthy();
  expect(`${e?.message} ${e?.cause?.message ?? ""}`).toMatch(/append-only/);
}

beforeAll(async () => {
  await resetTestDatabase();
  await seedW4b(db, { passwordHash: "!", documents: true });
  w = await loadW4b();
});

describe("W4B demo seed", () => {
  it("adds the second finance account and fictional tax placeholders only", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "finance2@bryels-care.test"));
    expect(u?.displayName).toBe("Ben Ocampo");
    const tax = (await db.execute(sql`select code, status, is_fictional from tax_configurations`)) as unknown as { code: string; status: string; is_fictional: boolean }[];
    expect(tax.length).toBeGreaterThan(0);
    expect(tax.every((t) => t.is_fictional && t.code.startsWith("FICT-"))).toBe(true);
    expect(tax.some((t) => t.status === "proposed")).toBe(true);
  });

  it("is idempotent: a second run adds nothing", async () => {
    const before = (await db.select().from(invoices)).length;
    await seedW4b(db, { passwordHash: "!", documents: true });
    expect((await db.select().from(invoices)).length).toBe(before);
  });

  it("export.reconciles_to_ledger: invoice, payment and credit projections equal their postings and applications", async () => {
    const invs = await db.select().from(invoices);
    expect(invs.length).toBeGreaterThan(0);
    const postings = await db.select().from(financialPostings);
    const apps = await db.select().from(paymentApplications);
    const cns = await db.select().from(creditNotes);
    for (const i of invs) {
      const issue = postings.filter((p) => p.documentType === "invoice" && p.documentId === i.id && p.postingType === "invoice_issue");
      if (["issued", "partially_paid", "paid"].includes(i.status)) {
        expect(issue).toHaveLength(1);
        expect(issue[0].amount).toBe(i.totalAmount);
      } else expect(issue).toHaveLength(0);
      const paid = apps.filter((a) => a.invoiceId === i.id).reduce((s, a) => s.plus(a.appliedAmount), new Decimal(0));
      expect(paid.toFixed(4)).toBe(i.paidAmount);
      const credited = cns.filter((c) => c.invoiceId === i.id && c.status === "applied").reduce((s, c) => s.plus(c.amount), new Decimal(0));
      expect(credited.toFixed(4)).toBe(i.creditedAmount);
    }
    for (const p of await db.select().from(paymentRecords)) {
      expect(postings.filter((x) => x.documentId === p.id && x.postingType === "payment")).toHaveLength(1);
      expect(apps.filter((a) => a.paymentRecordId === p.id).reduce((s, a) => s.plus(a.appliedAmount), new Decimal(0)).toFixed(4)).toBe(p.appliedAmount);
    }
    expect((await db.select().from(supplierBills)).some((b) => b.status === "disputed")).toBe(true);
  });

  it("the receivables summary and the invoice list read the seeded documents", async () => {
    const sum = await receivablesSummary(w.finance);
    expect(new Decimal(sum.outstanding).gt(0)).toBe(true);
    expect((await listInvoices(w.finance)).length).toBeGreaterThan(0);
  });
});

describe("append-only finance ledgers (custom SQL w4b)", () => {
  it("the custom migration is a verbatim copy of src/db/sql/w4b.sql", () => {
    const { migration, canonical } = customMigration("w4b");
    expect(migration.endsWith(canonical)).toBe(true);
  });

  it("reversal.immutable_original: UPDATE and DELETE are refused on postings, applications and transitions", async () => {
    const [t] = await db.select({ id: financeStateTransitions.id }).from(financeStateTransitions).limit(1);
    await refused(db.execute(sql`update finance_state_transitions set reason = 'x' where id = ${t.id}`));
    await refused(db.execute(sql`delete from finance_state_transitions where id = ${t.id}`));
    const [p] = await db.select({ id: financialPostings.id }).from(financialPostings).limit(1);
    await refused(db.execute(sql`update financial_postings set amount = 1 where id = ${p.id}`));
    await refused(db.execute(sql`delete from financial_postings where id = ${p.id}`));
    const [a] = await db.select({ id: paymentApplications.id }).from(paymentApplications).limit(1);
    await refused(db.execute(sql`update payment_applications set applied_amount = 1 where id = ${a.id}`));
    await refused(db.execute(sql`delete from payment_applications where id = ${a.id}`));
  });
});
