import type { ReactNode } from "react";
import { Logo } from "@/ui/brand";

/** Brand frame of the public portal pages (sign-in, verification, invitation): phone first. */
export function PortalFrame({ children, below }: { children: ReactNode; below?: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1fr]">
      <section
        className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col"
        style={{ background: "radial-gradient(120% 90% at 100% 0%, var(--lime-400) 0%, var(--brand-600) 45%, var(--brand-900) 100%)" }}
      >
        <svg aria-hidden="true" className="absolute -left-24 -top-24 size-[480px] opacity-[0.14]" viewBox="0 0 200 200">
          <path d="M100 10 C130 60, 170 80, 190 100 C170 120, 130 140, 100 190 C70 140, 30 120, 10 100 C30 80, 70 60, 100 10Z" fill="var(--lime-300)" />
        </svg>
        <div className="relative inline-flex w-fit rounded-[22px] bg-white px-5 py-3 shadow-[var(--shadow-pop)]">
          <Logo tagline className="h-16 w-auto" />
        </div>
        <div className="relative mt-auto max-w-[460px]">
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-white/75">Customer portal</p>
          <p className="mt-2 font-display text-[32px] font-semibold leading-tight">Your products, prices, orders and delivery papers in one place.</p>
          <ul className="mt-6 grid gap-2 text-[14px] text-white/85">
            <li>• Order from your approved catalogue at your agreed prices</li>
            <li>• Follow every order from review to delivery</li>
            <li>• Download your delivery receipts and quotations</li>
          </ul>
        </div>
        <p className="relative mt-10 text-[12px] text-white/60">Bryel&apos;s Care Corporation · for customers of Bryel&apos;s Care</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 flex items-center justify-between gap-3 lg:hidden">
            <Logo tagline className="h-12 w-auto" />
            <span className="rounded-full bg-[var(--lime-100)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--brand-800)]">Customer portal</span>
          </div>
          {children}
          {below}
        </div>
      </section>
    </main>
  );
}
