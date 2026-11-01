import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { CalendarUpdateNotifier } from "@/components/calendar/calendar-update-notifier";
import { IdleSessionGuard } from "@/components/session/idle-session-guard";
import { HotlineContact } from "@/components/support/hotline-contact";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { default: "Presence · Office attendance", template: "%s · Presence" },
  description: "Secure office attendance, leave, staff calendars and multi-branch workforce operations.",
  applicationName: "Presence",
  keywords: ["office attendance", "employee attendance", "leave management", "staff calendar", "workforce management", "Sri Lanka attendance"],
  authors: [{ name: "Presence" }],
  creator: "Presence",
  publisher: "Presence",
  category: "business software",
  openGraph: {
    type: "website",
    siteName: "Presence",
    title: "Presence · Secure office attendance",
    description: "Attendance, leave and workforce clarity across every office.",
    url: "/about",
    images: [{ url: "/icons/presence-512-v2.png", width: 512, height: 512, alt: "Presence office attendance" }],
  },
  twitter: { card: "summary", title: "Presence · Secure office attendance", description: "Attendance, leave and workforce clarity across every office.", images: ["/icons/presence-512-v2.png"] },
  robots: { index: false, follow: false, noarchive: true, nosnippet: false },
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
  userScalable: false,
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
        <HotlineContact />
      </body>
    </html>
  );
}
