"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import type { ActionState } from "@/lib/errors";

const Schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
const MAX_FAILURES = 5;

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const origin = (await headers()).get("origin");
  if (process.env.APP_ORIGIN && origin && origin !== process.env.APP_ORIGIN) return { ok: false, message: "Request origin not allowed." };
  const parsed = Schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: "Enter your email and password." };
  const rows = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const user = rows[0];
  const generic = { ok: false, message: "Email or password is incorrect." } as const;
  if (!user) return generic;
  if (user.status === "locked") return { ok: false, message: "This account is locked. Ask a system administrator to unlock it." };
  if (user.status !== "active") return generic;
  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({ failedLoginCount: failures, status: failures >= MAX_FAILURES ? "locked" : user.status })
      .where(eq(users.id, user.id));
    await db.insert(auditEvents).values({ organizationId: user.organizationId, actorId: user.id, action: "identity.session.sign_in_failed", entityType: "user", entityId: user.id });
    return generic;
  }
  await db.update(users).set({ failedLoginCount: 0, lastLoginAt: new Date() }).where(and(eq(users.id, user.id)));
  await createSession(user.id);
  await db.insert(auditEvents).values({ organizationId: user.organizationId, actorId: user.id, action: "identity.session.signed_in", entityType: "user", entityId: user.id });
  redirect("/dashboard");
}
