"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type CalendarToast = { title: string; date: string; action: string };

export function CalendarUpdateNotifier() {
  const router = useRouter();
  const [toast, setToast] = useState<CalendarToast | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: number | undefined;

    async function subscribe() {
      const { data } = await supabase.auth.getSession();
      if (disposed || !data.session || channel) return;
      channel = supabase.channel("calendar-notes-live").on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_notes" },
        (payload) => {
          const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { title?: string; note_date?: string };
          const action = payload.eventType === "DELETE" ? "Calendar item removed" : payload.eventType === "UPDATE" ? "Calendar updated" : "New calendar update";
          const next = { title: row.title || "Your work calendar changed", date: row.note_date || "", action };
          setToast(next);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => setToast(null), 8_000);
          router.refresh();
          if ("Notification" in window && Notification.permission === "granted") {
            const options = { body: `${next.title}${next.date ? ` · ${next.date}` : ""}`, icon: "/icons/icon-192.svg", data: { url: "/app#calendar" } };
            if ("serviceWorker" in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then((registration) => registration.showNotification(action, options)).catch(() => new Notification(action, options));
            else new Notification(action, options);
          }
        },
      ).subscribe();
    }

    subscribe();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) subscribe();
      else if (channel) { supabase.removeChannel(channel); channel = null; }
    });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      authListener.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [router]);

  if (!toast) return null;
  return <aside className="calendar-update-toast" role="status"><span><Bell size={18} /></span><div><small>{toast.action}</small><strong>{toast.title}</strong>{toast.date && <time>{toast.date}</time>}</div><Link href="/app#calendar" onClick={() => setToast(null)}>View</Link><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button></aside>;
}
