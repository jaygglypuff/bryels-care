import { redirect } from "next/navigation";

/** Superseded (ADR-080 §7.1, one path 2026-10-31): a new production order is made at /production/orders/new. */
export default function NewWorkOrderPage() {
  redirect("/production/orders/new");
}
