import { redirect } from "next/navigation";

/**
 * Superseded (ADR-115 §1): the production board on the old work-order and batch statuses is retired. The board view of
 * the production orders (/production/orders?view=board, columns by order status) replaces it. The old filters (site,
 * line, product, dates, assignee) have no equivalent there and are dropped; the current site applies. Kept as a server
 * redirect so bookmarks and old links work.
 */
export default function ProductionBoardRedirect() {
  redirect("/production/orders?view=board");
}
