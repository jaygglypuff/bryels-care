import Link from "next/link";

/**
 * The demo line (ADR-055; ADR-136: one slim neutral line fixed above the sidebar and the top bar, 26 px). The owner
 * also gets "Reset demo data". Rendered only when the layout passes it.
 */
const LINE = "no-print fixed inset-x-0 top-0 z-[45] flex h-[26px] items-center justify-center gap-2 border-b border-[var(--warn-bd)] bg-[var(--warn-bg)] px-4 text-[12px] leading-none text-[var(--warn-fg)]";
const LINK = "-my-[9px] shrink-0 py-[9px] font-semibold underline underline-offset-2 hover:no-underline";

export function DemoBanner({ canReset, sandbox = false }: { canReset: boolean; sandbox?: boolean }) {
  if (sandbox) {
    // ADR-072: the empty sandbox company — the owner builds everything from scratch with the guide.
    return (
      <div role="note" aria-label="Sandbox environment" className={LINE}>
        <span className="truncate">
          <span className="font-semibold">Sandbox</span>
          <span className="hidden sm:inline"> — your own empty practice company</span>
        </span>
        <Link href="/help#start.getting_started" className={LINK}>
          Getting started guide
        </Link>
        {canReset && (
          <Link href="/admin/demo" className={`${LINK} hidden sm:inline-block`}>
            Start over
          </Link>
        )}
      </div>
    );
  }
  return (
    <div role="note" aria-label="Demo environment" className={LINE}>
      <span className="truncate">
        <span className="font-semibold">Demo environment</span>
        <span className="hidden sm:inline"> — fictional data, safe to try anything</span>
        <span className="sm:hidden"> — fictional data</span>
      </span>
      {canReset && (
        <Link href="/admin/demo" className={LINK}>
          Reset demo data
        </Link>
      )}
    </div>
  );
}
