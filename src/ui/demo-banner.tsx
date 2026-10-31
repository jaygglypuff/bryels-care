import Link from "next/link";

/**
 * Slim strip at the very top of every app page while demo mode is on (ADR-055). One line on phones;
 * the owner also gets the way to "Reset demo data". Rendered only when the layout passes it.
 */
export function DemoBanner({ canReset, sandbox = false }: { canReset: boolean; sandbox?: boolean }) {
  if (sandbox) {
    // ADR-072: the empty sandbox company — the owner builds everything from scratch with the guide.
    return (
      <div role="note" aria-label="Sandbox environment" className="no-print border-b border-[var(--lime-300)] bg-[var(--lime-100)] text-[var(--brand-800)]">
        <div className="mx-auto flex max-w-[1480px] items-center justify-center gap-2 px-4 py-1 text-[12px] leading-[18px] sm:px-6">
          <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--brand-600)]" />
          <span className="truncate">
            <span className="font-semibold">Sandbox</span>
            <span className="hidden sm:inline"> — your own empty practice company</span>
          </span>
          <Link href="/help#start.getting_started" className="-my-[13px] shrink-0 py-[13px] font-semibold underline underline-offset-2 hover:text-[var(--brand-900)]">
            Getting started guide
          </Link>
          {canReset && (
            <Link href="/admin/demo" className="-my-[13px] hidden shrink-0 py-[13px] font-semibold underline underline-offset-2 hover:text-[var(--brand-900)] sm:inline-block">
              Start over
            </Link>
          )}
        </div>
      </div>
    );
  }
  return (
    <div role="note" aria-label="Demo environment" className="no-print border-b border-[var(--lime-300)] bg-[var(--lime-100)] text-[var(--brand-800)]">
      <div className="mx-auto flex max-w-[1480px] items-center justify-center gap-2 px-4 py-1 text-[12px] leading-[18px] sm:px-6">
        <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--brand-600)]" />
        <span className="truncate">
          <span className="font-semibold">Demo environment</span>
          <span className="hidden sm:inline"> — fictional data, safe to try anything</span>
          <span className="sm:hidden"> — fictional data</span>
        </span>
        {canReset && (
          <Link href="/admin/demo" className="-my-[13px] shrink-0 py-[13px] font-semibold underline underline-offset-2 hover:text-[var(--brand-900)]">
            Reset demo data
          </Link>
        )}
      </div>
    </div>
  );
}
