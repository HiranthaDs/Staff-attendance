import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Offline", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return <main className="offline-page"><section><Brand /><span><WifiOff size={28} /></span><h1>You&apos;re offline</h1><p>Reconnect before signing in, marking attendance, or sending leave. Attendance is never queued offline, which protects the time and location audit.</p><Link className="button button-primary" href="/">Try again</Link></section></main>;
}
