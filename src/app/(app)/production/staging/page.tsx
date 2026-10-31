import { redirect } from "next/navigation";

/**
 * Superseded (one path for production work, 2026-10-31): materials are taken on each batch's Materials
 * list, reached from the production orders ("Get materials"). The list scans labels and moves stock when
 * the site settings `production.prepare.scan_lots` / `production.prepare.move_stock` ask for it.
 * Kept as a server redirect so bookmarks and old links work.
 */
export default function StagingQueuePage() {
  redirect("/production/orders");
}
