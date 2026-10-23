import { redirect } from "next/navigation";

/** The lots list lives at /inventory (Lots & stock); keep /inventory/lots as a stable alias. */
export default function LotsAlias() {
  redirect("/inventory");
}
