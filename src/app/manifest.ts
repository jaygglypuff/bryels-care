import type { MetadataRoute } from "next";

/** Web app manifest (US-7-01): installable on phones and tablets, brand colours (ADR-024), served at /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Bryel's Care ERP",
    short_name: "Bryel's Care",
    description: "Manufacturing ERP + CRM for Bryel's Care: stock, production, quality and orders, with offline counting and weighing.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#eef2ea",
    theme_color: "#367a24",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Offline workspace", short_name: "Offline", url: "/offline", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Sync status", short_name: "Sync", url: "/sync", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
