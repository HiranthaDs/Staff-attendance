"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, CalendarDays, CheckCheck, Clock3, ShieldCheck, X } from "lucide-react";
import type { AppNotification } from "@/lib/types";

export function NotificationCenter({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const unread = items.filter((item) => !item.read_at).length;

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        setItems(result.notifications ?? []);
        setMigrationRequired(Boolean(result.migrationRequired));
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(initialize); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function markRead(id?: string) {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => !id || item.id === id ? { ...item, read_at: item.read_at || now } : item));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    });
  }

  return <div className={`notification-center ${compact ? "compact" : ""}`} ref={container}>
    <button className="icon-button bordered notification-trigger" onClick={() => { setOpen((current) => !current); void load(true); }} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}>
      {unread ? <BellRing size={19} /> : <Bell size={19} />}
      {unread > 0 && <span className="notification-count">{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && <aside className="notification-popover" aria-label="Notification center">
      <div className="notification-popover-head"><div><span className="eyebrow">UPDATES</span><h2>Notifications</h2></div><div>{unread > 0 && <button onClick={() => void markRead()}><CheckCheck size={15} /> Read all</button>}<button className="icon-button" onClick={() => setOpen(false)} aria-label="Close notifications"><X size={17} /></button></div></div>
      <div className="notification-list">
        {loading && !items.length && <div className="notification-empty">Loading notifications...</div>}
        {migrationRequired && <div className="notification-empty"><ShieldCheck size={22} /><strong>Notification upgrade pending</strong><small>Apply the latest database migration to activate the notification inbox.</small></div>}
        {!loading && !migrationRequired && !items.length && <div className="notification-empty"><Bell size={22} /><strong>You are all caught up</strong><small>Attendance, leave and calendar updates will appear here.</small></div>}
        {items.map((item) => <Link key={item.id} href={item.action_url} className={item.read_at ? "" : "unread"} onClick={() => { void markRead(item.id); setOpen(false); }}>
          <span className={`notification-kind ${item.kind}`}>{item.kind === "attendance" ? <Clock3 size={17} /> : item.kind === "calendar" || item.kind === "leave" ? <CalendarDays size={17} /> : <ShieldCheck size={17} />}</span>
          <span><strong>{item.title}</strong><small>{item.body}</small><time>{relativeTime(item.created_at)}</time></span>
        </Link>)}
      </div>
    </aside>}
  </div>;
}

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
