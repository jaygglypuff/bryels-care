import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return Response.json({ ok: true, database: "up", migrations: r[0]?.n ?? 0 });
  } catch {
    return Response.json({ ok: false, database: "down" }, { status: 503 });
  }
}
