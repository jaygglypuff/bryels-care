import { redirect } from "next/navigation";
import { readPortalMfaToken } from "@/modules/portal";
import { PortalFrame } from "../../../frame";
import { PortalVerifyForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer portal code" };

/** Second sign-in step for portal users who turned two-step sign-in on. */
export default async function PortalVerifyPage() {
  if (!(await readPortalMfaToken())) redirect("/portal/sign-in");
  return (
    <PortalFrame>
      <PortalVerifyForm />
    </PortalFrame>
  );
}
