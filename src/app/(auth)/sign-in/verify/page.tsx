import Link from "next/link";
import { readMfaCookie } from "@/lib/auth/session";
import { Card } from "@/ui/core";
import { AuthFrame } from "../../frame";
import { VerifyForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-step sign-in" };

export default async function VerifyPage() {
  const pending = await readMfaCookie();
  return (
    <AuthFrame>
      {pending ? (
        <VerifyForm />
      ) : (
        <Card>
          <h1 className="font-display text-[22px] font-semibold">Sign-in step expired</h1>
          <p className="mt-2 text-[13px] text-muted">For safety the code step lasts 10 minutes.</p>
          <Link href="/sign-in" className="mt-4 inline-block text-[14px] font-medium text-primary-text hover:underline">
            Sign in again
          </Link>
        </Card>
      )}
    </AuthFrame>
  );
}
