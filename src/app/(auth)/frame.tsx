import type { ReactNode } from "react";
import { Logo } from "@/ui/brand";

/** Brand frame shared by the sign-in, invitation, reset and verification pages. */
export function AuthFrame({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section
        className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col"
        style={{ background: "radial-gradient(120% 90% at 0% 0%, var(--brand-500) 0%, var(--brand-700) 55%, var(--brand-900) 100%)" }}
      >
        <svg aria-hidden="true" className="absolute -right-24 -top-24 size-[520px] opacity-[0.16]" viewBox="0 0 200 200">
          <path d="M100 10 C130 60, 170 80, 190 100 C170 120, 130 140, 100 190 C70 140, 30 120, 10 100 C30 80, 70 60, 100 10Z" fill="var(--lime-300)" />
        </svg>
        <svg aria-hidden="true" className="absolute -bottom-32 -left-20 size-[420px] opacity-[0.12]" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="96" fill="none" stroke="var(--lime-300)" strokeWidth="14" />
        </svg>
        <div className="relative inline-flex w-fit rounded-[22px] bg-white px-5 py-3 shadow-[var(--shadow-pop)]">
          <Logo tagline className="h-16 w-auto" />
        </div>
        <div className="relative mt-auto max-w-[460px]">
          <p className="font-display text-[34px] font-semibold leading-tight">From raw material to the customer&apos;s shelf, every lot accounted for.</p>
          <ul className="mt-6 grid gap-2 text-[14px] text-white/85">
            <li>• Receive, label and release materials with QA control</li>
            <li>• Digital Batch Manufacturing Records with checked weighing</li>
            <li>• FEFO picking, dispatch and full lot traceability</li>
          </ul>
        </div>
        <p className="relative mt-10 text-[12px] text-white/60">Bryel&apos;s Care Corporation · Manufacturing ERP + CRM</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 lg:hidden">
            <Logo tagline className="h-14 w-auto" />
          </div>
          {children}
          {below}
        </div>
      </section>
    </main>
  );
}
