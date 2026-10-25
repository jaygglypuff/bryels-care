import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: ["500", "600", "700"], style: ["normal", "italic"], variable: "--font-poppins", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Bryel's Care ERP", template: "%s · Bryel's Care ERP" },
  description: "Manufacturing ERP + CRM for Bryel's Care Corporation",
  // W4D (US-7-01): installable app; the manifest comes from src/app/manifest.ts.
  appleWebApp: { capable: true, title: "Bryel's Care", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#367a24" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
