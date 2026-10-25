import { requireContext } from "@/lib/auth/context";
import { isDemoMode } from "@/lib/demo";
import { DEMO_RESET_CONFIRM_WORD, demoResetStatus } from "@/modules/platform";
import { Card, CardTitle, EmptyState, LinkButton, PageHeader } from "@/ui/core";
import { Banner } from "@/ui/status";
import { StepUpGate } from "../users/step-up-gate";
import { ResetDemoForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset demo data" };

/** Owner-only reset of the fictional demo data (ADR-055, docs/railway-for-dummies.md "Reset the demo"). */
export default async function DemoResetPage() {
  const ctx = await requireContext();
  if (!isDemoMode()) {
    return (
      <EmptyState title="Not a demo environment" action={<LinkButton href="/dashboard" variant="secondary">Back to overview</LinkButton>}>
        Demo data can only be reset where demo mode is switched on. This system holds real data, which is never wiped.
      </EmptyState>
    );
  }
  const status = await demoResetStatus(ctx);
  return (
    <>
      <PageHeader title="Reset demo data" subtitle="Start the demo again from a fresh copy of the fictional company." />
      {!status.available ? (
        <Banner tone={status.realAccounts > 0 ? "bad" : "warn"} title="Reset is not available">
          {status.reason}
        </Banner>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardTitle>What happens</CardTitle>
            <ol className="list-decimal space-y-1.5 pl-5 text-[14px] text-fg-2">
              <li>Every record is deleted: batches, lots, orders, customers, every change made in the demo, the audit log and every signed-in device. Uploaded files stay in storage but are no longer linked to anything.</li>
              <li>The fictional company is loaded again with its demo accounts (password demo1234).</li>
              <li>The empty sandbox company ("Start from scratch") is emptied: everything built there is removed.</li>
              <li>You are signed out and land on the sign-in page. Everyone else is signed out too.</li>
            </ol>
            <p className="mt-3 text-[13px] text-muted">The reset is recorded in the new audit log and in Railway&apos;s logs. It cannot be undone.</p>
          </Card>
          <Card>
            <CardTitle>Confirm</CardTitle>
            <StepUpGate ctx={ctx} purpose="reset the demo data" />
            <ResetDemoForm word={DEMO_RESET_CONFIRM_WORD} />
          </Card>
        </div>
      )}
    </>
  );
}
