import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// ADR-136: one family (Inter) for text and headings.

export const metadata: Metadata = {
  // ADR-132 §7: every page sets its own title; the tab reads "<page> · Bryel's Care".
  title: { default: "Bryel's Care", template: "%s · Bryel's Care" },
  description: "Manufacturing ERP + CRM for Bryel's Care Corporation",
  // W4D (US-7-01): installable app; the manifest comes from src/app/manifest.ts.
  appleWebApp: { capable: true, title: "Bryel's Care", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#367a24" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the app layout sets data-sidebar on <html> before paint (collapsed sidebar, ADR-136).
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
