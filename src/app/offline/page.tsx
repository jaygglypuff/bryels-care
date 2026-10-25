import type { Metadata } from "next";
import { OfflineWorkspace } from "./workspace";

/**
 * Offline workspace (US-7-01, US-7-04). A static page with no user data in its HTML, so the service
 * worker can precache it and serve it to anyone on this device without leaking an authenticated page
 * (ADR-018: never cache authenticated HTML across users). Everything it shows comes from this
 * device's IndexedDB, which belongs to the person signed in and is wiped at sign-out.
 */
export const dynamic = "force-static";
export const metadata: Metadata = { title: "Offline workspace", robots: { index: false } };

export default function OfflinePage() {
  return <OfflineWorkspace />;
}
