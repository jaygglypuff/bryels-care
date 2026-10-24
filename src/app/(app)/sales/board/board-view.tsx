"use client";
import Link from "next/link";
import { startTransition, useRef, useState, useTransition } from "react";
import { fmtDate, fmtMoney, fmtQty } from "@/lib/qty";
import type { OrderBoard, OrderCard } from "@/modules/sales/orders-board";
import { Button, cx } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";
import { boardMoveOrderAction } from "../orders/actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
type Dialog = { title: string; body: string; tone: "ok" | "warn" | "info" };

function Card({ c, columns, busy, onMove, onDragStart }: { c: OrderCard; columns: { key: string; title: string }[]; busy: boolean; onMove: (c: OrderCard, to: string) => void; onDragStart: (c: OrderCard) => void }) {
  const allowed = columns.filter((col) => c.moves[col.key]?.allowed);
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", c.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(c);
      }}
      className="rounded-[14px] border border-line bg-surface p-3 shadow-sm"
      aria-label={`Order ${c.orderNumber}`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <Link href={`/sales/${c.id}`} className="whitespace-nowrap font-mono text-[13px] font-semibold text-primary-text hover:underline">
          {c.orderNumber}
        </Link>
        {c.value !== undefined && <span className="text-[12px] font-medium tabular">{fmtMoney(c.value)}</span>}
      </div>
      <p className="mt-1 text-[13px] font-medium">{c.customerName}</p>
      <p className="text-[12px] text-muted tabular">
        {c.lineCount} line{c.lineCount === 1 ? "" : "s"} · {fmtQty(c.units, "pcs", 0)} · deliver {fmtDate(c.requestedDeliveryOn)}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {c.overdue && <Chip tone="bad">Past requested date</Chip>}
        {c.reasons.map((r) => (
          <Chip key={r.code + r.message} tone="warn">
            {r.message}
          </Chip>
        ))}
        {c.warnings.map((r) => (
          <Chip key={r.code + r.message} tone="info">
            {r.code === "moq" ? "Below MOQ" : r.code === "lead_time" ? "Inside lead time" : r.message}
          </Chip>
        ))}
      </div>
      {allowed.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-[12px]">
          <span className="sr-only">Move {c.orderNumber} to</span>
          <select
            disabled={busy}
            className="min-h-[34px] w-full min-w-0 rounded-full border border-line bg-surface px-3 text-[12px]"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) onMove(c, e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Move to…</option>
            {allowed.map((col) => {
              const v = c.moves[col.key];
              return (
                <option key={col.key} value={col.key}>
                  {col.title}: {v.allowed ? v.label : ""}
                </option>
              );
            })}
          </select>
        </label>
      )}
    </article>
  );
}

/**
 * Sales order board (US-4-06). Drops are checked against the server-computed verdicts first: a
 * refused move only explains why; an allowed one calls the real service, which re-checks everything.
 * The action re-renders the page (ADR-043); the dialog update is wrapped in startTransition (rule 5).
 */
export function OrderBoardView({ board }: { board: OrderBoard }) {
  const dragged = useRef<OrderCard | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, start] = useTransition();
  const columns = board.columns.map((c) => ({ key: c.key, title: c.title }));

  const move = (c: OrderCard, to: string) => {
    const v = c.moves[to];
    const col = columns.find((x) => x.key === to);
    if (!v || !v.allowed) {
      if (v && !v.allowed && v.reason === "The card is already in this column.") return;
      setDialog({ title: `${c.orderNumber} can't move to ${col?.title ?? "this column"}`, body: v && !v.allowed ? v.reason : "Not a step of the process.", tone: "info" });
      return;
    }
    start(async () => {
      const r = await boardMoveOrderAction({ orderId: c.id, toColumn: to, idempotencyKey: newKey() });
      startTransition(() => setDialog({ title: r.ok ? v.label : `${c.orderNumber} was not moved`, body: r.message, tone: r.ok ? "ok" : "warn" }));
    });
  };

  return (
    <div>
      {dialog && (
        <div role="dialog" aria-modal="true" aria-labelledby="order-board-dialog" className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={() => setDialog(null)}>
          <div className="w-full max-w-md rounded-[20px] bg-surface p-5 shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
            <h2 id="order-board-dialog" className="font-display text-[17px] font-semibold">
              {dialog.title}
            </h2>
            <div className="mt-3">
              <Banner tone={dialog.tone} title={dialog.tone === "ok" ? "Done" : "Nothing changed"}>
                {dialog.body}
              </Banner>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" autoFocus onClick={() => setDialog(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
      {pending && (
        <p role="status" className="mb-2 text-[13px] text-muted">
          Moving…
        </p>
      )}
      <div className="flex max-w-full snap-x snap-mandatory gap-3 overflow-x-auto pb-3" aria-label="Sales order board columns">
        {board.columns.map((col) => (
          <section
            key={col.key}
            aria-label={col.title}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (dragged.current) move(dragged.current, col.key);
              dragged.current = null;
            }}
            className={cx(
              "flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-[16px] border bg-surface-2/60 p-2.5 sm:w-[270px]",
              over === col.key ? (dragged.current?.moves[col.key]?.allowed ? "border-primary" : "border-[var(--warn-bd)]") : "border-line",
            )}
          >
            <header className="mb-2 flex items-baseline justify-between px-1">
              <h2 className="text-[13px] font-semibold">{col.title}</h2>
              <span className="text-[12px] text-muted tabular">{col.cards.length}</span>
            </header>
            <div className="flex flex-col gap-2">
              {col.cards.length === 0 ? (
                <p className="px-1 py-4 text-center text-[12px] text-muted">None</p>
              ) : (
                col.cards.map((c) => <Card key={c.id} c={c} columns={columns} busy={pending} onMove={move} onDragStart={(x) => (dragged.current = x)} />)
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Moves you can make here: submit a draft (the credit and approval check decides confirmed or pending approval), approve a pending order when you are its approver, allocate a confirmed
        order (warehouse). Returning, cancelling, picking, packing and dispatch are done on the order page.
      </p>
    </div>
  );
}
