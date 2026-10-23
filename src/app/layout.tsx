import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Bryel's Care ERP", template: "%s · Bryel's Care ERP" },
  description: "Manufacturing ERP + CRM for Bryel's Care Corporation",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#28804b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
