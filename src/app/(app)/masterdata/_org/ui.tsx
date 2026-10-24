import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/ui/core";
import { Banner, Chip } from "@/ui/status";

/** Shared presentational bits for the W2G master data screens (server components). */
const TONES: Record<string, "ok" | "warn" | "bad" | "neu" | "info" | "hold"> = {
  active: "ok",
  draft: "neu",
  pending_approval: "info",
  approved: "ok",
  rejected: "bad",
  retired: "neu",
  blocked: "hold",
  down: "warn",
  inactive: "neu",
  discontinued: "neu",
};

export function StateChip({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  return <Chip tone={TONES[status] ?? "neu"}>{label.charAt(0).toUpperCase() + label.slice(1)}</Chip>;
}

export function ActiveChip({ active }: { active: boolean }) {
  return <StateChip status={active ? "active" : "inactive"} />;
}

/** Collapsible "add" card so list pages stay short on phones. */
export function AddCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <details>
        <summary className="cursor-pointer select-none font-display text-[17px] font-semibold text-fg">{title}</summary>
        <div className="mt-4">{children}</div>
      </details>
    </Card>
  );
}

export function Saved({ show, title, children }: { show: boolean; title: string; children?: ReactNode }) {
  return show ? <Banner tone="ok" title={title}>{children}</Banner> : null;
}

/** A card linking to a detail page (phone list item). */
export function RowCard({ href, title, code, meta, chips }: { href: string; title: string; code: string; meta?: ReactNode; chips?: ReactNode }) {
  return (
    <li>
      <Link href={href} className="block rounded-[16px] border border-line bg-surface p-3 hover:bg-surface-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0 break-words font-mono text-[13px] font-semibold">{code}</span>
          <span className="flex flex-wrap gap-1">{chips}</span>
        </div>
        <p className="mt-1 break-words text-[14px]">{title}</p>
        {meta && <p className="mt-1 text-[12px] text-muted">{meta}</p>}
      </Link>
    </li>
  );
}

export function ReadOnlyNote({ what }: { what: string }) {
  return <p className="text-[13px] text-muted">You can view {what}; changes are made by the roles that administer it.</p>;
}
