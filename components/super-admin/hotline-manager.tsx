"use client";

import { useState } from "react";
import { Headphones, LoaderCircle, MessageCircle, PhoneCall, Plus, X } from "lucide-react";
import type { PlatformHotline } from "@/lib/types";

export function HotlineManager({ initialHotlines }: { initialHotlines: PlatformHotline[] }) {
  const [hotlines, setHotlines] = useState(initialHotlines);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function toggle(hotline: PlatformHotline) {
    setBusy(hotline.id); setError("");
    const response = await fetch("/api/super-admin/hotlines", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: hotline.id, active: !hotline.active }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) setHotlines((current) => current.map((item) => item.id === hotline.id ? result.hotline as PlatformHotline : item));
    else setError(result.error || "The support line could not be updated.");
    setBusy(null);
  }

  return <section className="panel platform-hotline-panel"><div className="platform-section-head"><div><span className="eyebrow">CLIENT SUPPORT DIRECTORY</span><h2>Call and WhatsApp hotlines</h2><p>Publish multiple direct contacts across every staff and client portal.</p></div><button className="button button-primary" onClick={() => setOpen(true)}><Plus size={17} /> Add number</button></div>
    {error && <div className="form-alert error">{error}</div>}
    <div className="platform-hotline-grid">{hotlines.map((hotline) => <article key={hotline.id} className={hotline.active ? "" : "inactive"}><span className="hotline-icon"><Headphones size={19} /></span><div><strong>{hotline.label}</strong><small>{hotline.phone_e164}</small><p>{hotline.availability || "Availability not specified"}</p><div>{hotline.call_enabled && <span><PhoneCall size={13} /> Calls</span>}{hotline.whatsapp_enabled && <span className="whatsapp"><MessageCircle size={13} /> WhatsApp</span>}</div></div><button className="button button-ghost button-sm" disabled={busy === hotline.id} onClick={() => void toggle(hotline)}>{busy === hotline.id ? <LoaderCircle className="spin" size={15} /> : hotline.active ? "Disable" : "Enable"}</button></article>)}{!hotlines.length && <div className="platform-empty"><Headphones size={24} /><strong>No support lines published</strong><small>Add two or more contacts so staff always have a backup number.</small></div>}</div>
    {open && <CreateHotlineModal onClose={() => setOpen(false)} onCreated={(hotline) => { setHotlines((current) => [...current, hotline].sort((a, b) => a.sort_order - b.sort_order)); setOpen(false); }} />}
  </section>;
}
function CreateHotlineModal({ onClose, onCreated }: { onClose: () => void; onCreated: (hotline: PlatformHotline) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [callEnabled, setCallEnabled] = useState(true);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/super-admin/hotlines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, call_enabled: callEnabled, whatsapp_enabled: whatsappEnabled }) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) onCreated(result.hotline as PlatformHotline);
    else { setError(result.error || "The support contact could not be created."); setLoading(false); }
  }
  return <div className="modal-backdrop elevated-modal" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal hotline-admin-modal" role="dialog" aria-modal="true" aria-labelledby="hotline-admin-title"><div className="modal-head"><div><span className="eyebrow">NEW SUPPORT LINE</span><h2 id="hotline-admin-title">Publish a contact number</h2><p>Local Sri Lankan numbers are converted to +94 automatically.</p></div><button className="icon-button bordered" onClick={onClose} aria-label="Close"><X size={19} /></button></div><form className="form-grid" onSubmit={submit}><label className="field field-span"><span>Contact label</span><input name="label" required minLength={2} maxLength={60} placeholder="Primary support" /></label><label className="field"><span>Phone number</span><input name="phone" type="tel" required minLength={7} maxLength={30} placeholder="+94 77 123 4567" /></label><label className="field"><span>Availability</span><input name="availability" maxLength={100} placeholder="Mon–Fri · 8:30 AM–5:30 PM" /></label><label className="field"><span>Display order</span><input name="sort_order" type="number" min={0} max={1000} defaultValue={0} /></label><div className="field contact-method-field"><span>Contact methods</span><label><input type="checkbox" checked={callEnabled} onChange={(event) => setCallEnabled(event.target.checked)} /> Normal call</label><label><input type="checkbox" checked={whatsappEnabled} onChange={(event) => setWhatsappEnabled(event.target.checked)} /> WhatsApp</label></div>{error && <div className="form-alert error field-span">{error}</div>}<div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading || (!callEnabled && !whatsappEnabled)}>{loading ? <><LoaderCircle className="spin" size={16} /> Publishing…</> : "Publish contact"}</button></div></form></div></div>;
}
