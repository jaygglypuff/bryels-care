import { redirect } from "next/navigation";
import { getContext } from "@/lib/auth/context";
import { SignInForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getContext()) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-10 place-items-center rounded-[11px] bg-primary text-[15px] font-bold text-white">BC</span>
          <div>
            <p className="font-semibold text-fg">Bryel&apos;s Care</p>
            <p className="text-[12px] text-muted">Manufacturing ERP + CRM</p>
          </div>
        </div>
        <SignInForm />
        {process.env.ALLOW_DEMO_SEED === "true" && (
          <div className="mt-5 rounded-[14px] border border-line bg-surface p-4 text-[12px] text-fg-2">
            <p className="mb-2 font-semibold text-fg">Demo accounts (fictional data) · password <code className="font-mono">demo1234</code></p>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              <li>owner@bryels-care.test</li>
              <li>manager.nfd@bryels-care.test</li>
              <li>operator.nfd@bryels-care.test</li>
              <li>checker.nfd@bryels-care.test</li>
              <li>warehouse.nfd@bryels-care.test</li>
              <li>qa.nfd@bryels-care.test</li>
              <li>sales@bryels-care.test</li>
              <li>warehouse.rvs@bryels-care.test</li>
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
