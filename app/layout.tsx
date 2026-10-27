import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { CalendarUpdateNotifier } from "@/components/calendar/calendar-update-notifier";
import { IdleSessionGuard } from "@/components/session/idle-session-guard";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: { default: "Presence · Office attendance", template: "%s · Presence" },
  description: "Secure, effortless office attendance for every branch.",
  applicationName: "Presence",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Presence" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/presence-192-v2.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/presence-512-v2.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/presence-192-v2.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#e9eee8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${manrope.variable}`}>
        {children}
        <CalendarUpdateNotifier />
        <PwaRegister />
        <IdleSessionGuard />
      </body>
    </html>
  );
}
