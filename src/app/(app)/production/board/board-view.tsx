"use client";
import Link from "next/link";
import { startTransition, useRef, useState, useTransition } from "react";
import { fmtDate, fmtMass } from "@/lib/qty";
import type { BoardCard, ProductionBoard } from "@/modules/production/board";
import { Button, cx } from "@/ui/core";
import { Banner, Chip, StatusChip } from "@/ui/status";
import { boardMoveAction } from "../work-orders/actions";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
type Dialog = { title: string; body: string; tone: "ok" | "warn" | "bad" | "info" };

function Card({ c, onMove, busy, columns, onDragStart }: { c: BoardCard; onMove: (c: BoardCard, to: string) => void; busy: boolean; columns: { key: string; title: string }[]; onDragStart: (c: BoardCard) => void }) {
  const pct = c.progress && c.progress.total ? Math.round((c.progress.done / c.progress.total) * 100) : 0;
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
      data-testid="board-card"
      aria-label={`${c.kind === "work_order" ? "Production order" : "Batch"} ${c.number}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <Link href={c.href} className="whitespace-nowrap font-mono text-[13px] font-semibold text-primary-text hover:underline">
          {c.number}
        </Link>
        <StatusChip status={c.status} />
      </div>
      <p className="mt-1 text-[13px] font-medium">{c.productName}</p>
      <p className="text-[12px] text-muted tabular">
        {c.kind === "work_order" ? `WO · ${c.batchCount} batch${c.batchCount === 1 ? "" : "es"} · ${fmtMass(c.sizeG)}` : `${fmtMass(c.sizeG)}${c.workOrderNumber ? ` · ${c.workOrderNumber}` : ""}`}
      </p>
      <p className="text-[12px] text-muted">
        {c.lineCode ?? "No line"} · {c.plannedStart ? `start ${fmtDate(c.plannedStart)}` : "not scheduled"}
      </p>
      {c.progress && (
        <div className="mt-2">
          <div className="flex justify-between text-[11px] text-fg-2">
            <span>
              {["draft", "planned", "materials_staged"].includes(c.status)
                ? `Not started · ${c.progress.total} steps`
                : c.progress.done >= c.progress.total
                  ? `${c.progress.total} of ${c.progress.total} steps`
                  : `Step ${Math.min(c.progress.done + 1, c.progress.total)} of ${c.progress.total}`}
            </span>
            <span className="tabular">{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {c.assignees.map((a) => (
          <span key={a.id} title={a.name} className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary-text">
            {a.initials}
          </span>
        ))}
        {c.risks.map((r) => (
          <Chip key={r.label} tone={r.tone}>{r.label}</Chip>
        ))}
      </div>
      {allowed.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-[12px]">
          <span className="sr-only">Move {c.number} to</span>
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
 * Board columns (desktop grid scrolls inside its container; phones get a horizontal snap
 * carousel). Drops are checked against the server-computed verdicts first: a refused move only
 * opens the explanation; an allowed one calls the server, which re-checks everything.
 */
export function BoardView({ board }: { board: ProductionBoard }) {
  const dragged = useRef<BoardCard | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, start] = useTransition();
  const columns = board.columns.map((c) => ({ key: c.key, title: c.title }));

  const move = (c: BoardCard, to: string) => {
    const v = c.moves[to];
    const col = columns.find((x) => x.key === to);
    if (!v || !v.allowed) {
      if (v && !v.allowed && v.reason === "The card is already in this column.") return;
      setDialog({ title: `${c.number} can't move to ${col?.title ?? "this column"}`, body: v && !v.allowed ? v.reason : "Not a step of the process.", tone: "info" });
      return;
    }
    start(async () => {
      const r = await boardMoveAction({ kind: c.kind, id: c.id, toColumn: to, idempotencyKey: newKey() });
      // The action's response re-renders the board (refreshCurrentPage, ADR-043); wrapping the
      // update after the await keeps it in that transition, so the dialog and the moved card
      // commit together.
      startTransition(() => setDialog({ title: r.ok ? v.label : `${c.number} was not moved`, body: r.message, tone: r.ok ? "ok" : "warn" }));
    });
  };

  return (
    <div>
      {dialog && (
        <div role="dialog" aria-modal="true" aria-labelledby="board-dialog-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={() => setDialog(null)}>
          <div className="w-full max-w-md rounded-[20px] bg-surface p-5 shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
            <h2 id="board-dialog-title" className="font-display text-[17px] font-semibold">{dialog.title}</h2>
            <div className="mt-3">
              <Banner tone={dialog.tone} title={dialog.tone === "ok" ? "Done" : "Nothing changed"}>{dialog.body}</Banner>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" autoFocus onClick={() => setDialog(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
      {pending && <p role="status" className="mb-2 text-[13px] text-muted">Moving…</p>}
      <div className="flex max-w-full snap-x snap-mandatory gap-3 overflow-x-auto pb-3" aria-label="Production board columns">
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
              "flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-[16px] border bg-surface-2/60 p-2.5 sm:w-[280px]",
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
                col.cards.map((c) => <Card key={`${c.kind}:${c.id}`} c={c} onMove={move} busy={pending} columns={columns} onDragStart={(x) => (dragged.current = x)} />)
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        You can move a card: plan a draft production order, approve a planned one (its materials are set aside), or start a batch whose materials are ready. QA decides when a batch may be sold.
      </p>
    </div>
  );
}
