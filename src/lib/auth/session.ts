import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";

export const SESSION_COOKIE = "bc_session";
export const SITE_COOKIE = "bc_site";
const IDLE_MS = 8 * 60 * 60 * 1000; // 8 h idle (A-SEC defaults; shorter for shared devices later)
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ABSOLUTE_MS),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ABSOLUTE_MS / 1000,
  });
}

/** Returns the active session's user id, or null. Enforces idle and absolute expiry. */
export async function readSession(): Promise<{ sessionId: string; userId: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!s) return null;
  if (Date.now() - s.lastSeenAt.getTime() > IDLE_MS) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, s.id));
  }
  return { sessionId: s.id, userId: s.userId };
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}
