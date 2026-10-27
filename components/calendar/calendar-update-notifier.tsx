"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type CalendarToast = { title: string; date: string; action: string };

export function CalendarUpdateNotifier() {
  const pathname = usePathname();
  const lastEventKey = useRef("");
  const [toast, setToast] = useState<CalendarToast | null>(null);

  useEffect(() => {
    const isPortal = pathname === "/app"
      || pathname === "/admin"
      || pathname === "/profile"
      || pathname.startsWith("/admin/");
    if (!isPortal) return;

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
          const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { id?: string; title?: string; note_date?: string; updated_at?: string };
          const eventKey = `${payload.eventType}:${row.id || "unknown"}:${row.updated_at || payload.commit_timestamp || ""}`;
          if (lastEventKey.current === eventKey) return;
          lastEventKey.current = eventKey;
          const action = payload.eventType === "DELETE" ? "Calendar item removed" : payload.eventType === "UPDATE" ? "Calendar updated" : "New calendar update";
          const next = { title: row.title || "Your work calendar changed", date: row.note_date || "", action };
          setToast(next);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => setToast(null), 8_000);
          window.dispatchEvent(new CustomEvent("presence:calendar-updated", {
            detail: { eventType: payload.eventType, note: row },
          }));
          if ("Notification" in window && Notification.permission === "granted") {
            const options = { body: `${next.title}${next.date ? ` · ${next.date}` : ""}`, icon: "/icons/presence-192-v2.png", data: { url: "/app#calendar" } };
            if ("serviceWorker" in navigator && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(async (registration) => {
              const pushSubscription = await registration.pushManager?.getSubscription();
              if (!pushSubscription) await registration.showNotification(action, options);
            }).catch(() => new Notification(action, options));
            else new Notification(action, options);
          }
        },
      ).subscribe();
    }

    subscribe();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) void subscribe();
      else if (event === "SIGNED_OUT" && channel) { void supabase.removeChannel(channel); channel = null; }
    });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      authListener.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [pathname]);

  if (!toast) return null;
  return <aside className="calendar-update-toast" role="status"><span><Bell size={18} /></span><div><small>{toast.action}</small><strong>{toast.title}</strong>{toast.date && <time>{toast.date}</time>}</div><Link href="/app#calendar" onClick={() => setToast(null)}>View</Link><button onClick={() => setToast(null)} aria-label="Dismiss"><X size={16} /></button></aside>;
}
