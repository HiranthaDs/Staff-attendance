import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import { CalendarUpdateNotifier } from "@/components/calendar/calendar-update-notifier";
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
};

export const viewport: Viewport = {
  themeColor: "#eaf8ff",
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
      </body>
    </html>
  );
}
