import { PortalFrame } from "../../frame";
import { PortalInviteForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer portal invitation", referrer: "no-referrer" };

export default function PortalInvitePage() {
  return (
    <PortalFrame>
      <PortalInviteForm />
    </PortalFrame>
  );
}
