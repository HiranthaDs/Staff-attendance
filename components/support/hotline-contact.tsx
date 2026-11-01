"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Headphones, MessageCircle, PhoneCall, X } from "lucide-react";
import type { PlatformHotline } from "@/lib/types";

const visiblePortals = ["/app", "/profile", "/admin"];

export function HotlineContact() {
  const pathname = usePathname();
  const visible = visiblePortals.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const [open, setOpen] = useState(false);
  const [hotlines, setHotlines] = useState<PlatformHotline[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visible || loaded) return;
    let active = true;
    fetch("/api/hotlines", { cache: "no-store" }).then((response) => response.json()).then((result) => {
      if (active) setHotlines(result.hotlines ?? []);
    }).catch(() => undefined).finally(() => active && setLoaded(true));
    return () => { active = false; };
  }, [loaded, visible]);

  const whatsappMessage = useMemo(() => encodeURIComponent(`Hello Presence support, I need help with the attendance system. Page: ${pathname}`), [pathname]);
  if (!visible || (loaded && hotlines.length === 0)) return null;

  return <>
    <button className={`hotline-fab ${pathname.startsWith("/app") || pathname.startsWith("/profile") ? "employee-portal" : ""}`} onClick={() => setOpen(true)} aria-label="Contact platform support"><Headphones size={21} /><span>Support</span></button>
    {open && <div className="hotline-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="hotline-sheet" role="dialog" aria-modal="true" aria-labelledby="hotline-title">
      <div className="hotline-head"><div><span className="eyebrow">DIRECT SUPPORT</span><h2 id="hotline-title">Contact the super admin</h2><p>Choose any available support line for a normal call or WhatsApp.</p></div><button className="icon-button bordered" onClick={() => setOpen(false)} aria-label="Close support"><X size={19} /></button></div>
      <div className="hotline-list">{hotlines.map((hotline) => <article key={hotline.id}><div><span className="hotline-icon"><Headphones size={18} /></span><span><strong>{hotline.label}</strong><small>{hotline.phone_e164}{hotline.availability ? ` · ${hotline.availability}` : ""}</small></span></div><div className="hotline-actions">{hotline.call_enabled && <a href={`tel:${hotline.phone_e164}`}><PhoneCall size={17} /> Call</a>}{hotline.whatsapp_enabled && <a className="whatsapp" href={`https://wa.me/${hotline.phone_e164.replace(/\D/g, "")}?text=${whatsappMessage}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> WhatsApp</a>}</div></article>)}</div>
      {!loaded && <div className="hotline-loading">Loading support contacts…</div>}
    </section></div>}
  </>;
}
