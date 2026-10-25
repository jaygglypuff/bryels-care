import { fmtDateTime } from "@/lib/qty";
import { PORTAL_ROLE_BUNDLES, portalAccountState, requirePortalContext } from "@/modules/portal";
import { Card, CardTitle, Dl, PageHeader } from "@/ui/core";
import { Chip } from "@/ui/status";
import { ChangePasswordForm, TotpDisableForm, TotpEnrolForm } from "./forms";

export const metadata = { title: "Your portal account" };

/** Own portal account: who you are, password change, optional two-step sign-in. */
export default async function PortalAccountPage() {
  const ctx = await requirePortalContext();
  const s = await portalAccountState(ctx);
  const role = PORTAL_ROLE_BUNDLES[ctx.portalRole];
  return (
    <>
      <PageHeader title="Your account" subtitle={`${ctx.customerName} · customer portal`} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>You</CardTitle>
          <Dl
            items={[
              ["Name", s.displayName],
              ["Email", s.email],
              ["Company", ctx.customerName],
              ["Access", role.name],
              ["Last sign-in", fmtDateTime(s.lastLoginAt)],
            ]}
          />
          <p className="mt-3 text-[12.5px] text-muted">{role.description} To change your name, email or access, ask your Bryel&apos;s Care sales representative.</p>
        </Card>
        <Card>
          <CardTitle action={s.mfaEnabled ? <Chip tone="ok">On</Chip> : <Chip tone="neu">Off</Chip>}>Two-step sign-in</CardTitle>
          <p className="mb-3 text-[13px] text-fg-2">Optional. When it is on, signing in also asks for a 6-digit code from an authenticator app on your phone.</p>
          {s.mfaEnabled ? <TotpDisableForm /> : <TotpEnrolForm />}
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle>Change password</CardTitle>
          <ChangePasswordForm email={s.email} />
        </Card>
      </div>
    </>
  );
}
