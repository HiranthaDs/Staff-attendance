"use client";

import { useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Copy,
  Link2,
  LoaderCircle,
  MapPin,
  Network,
  Router,
  Send,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import { verificationModeLabels } from "@/lib/constants";
import type { Branch, BranchSetupInvite, BranchSetupSubmission } from "@/lib/types";

export function BranchSetupView({ initialInvites, initialSubmissions, onBranchCreated }: { initialInvites: BranchSetupInvite[]; initialSubmissions: BranchSetupSubmission[]; onBranchCreated: (branch: Branch) => void }) {
  const [invites, setInvites] = useState(initialInvites);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [modalOpen, setModalOpen] = useState(false);
  const pending = submissions.filter((item) => !item.created_branch_id);

  async function approve(id: string) {
    setSubmissions((current) => current.map((item) => item.id === id ? { ...item, approving: true } as BranchSetupSubmission : item));
    const response = await fetch(`/api/admin/branch-submissions/${id}/approve`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      window.alert(result.error);
      setSubmissions((current) => current.map((item) => item.id === id ? { ...item, approving: false } as BranchSetupSubmission : item));
      return;
    }
    setSubmissions((current) => current.map((item) => item.id === id ? { ...item, created_branch_id: result.branch.id } : item));
    setInvites((current) => current.map((invite) => invite.id === submissions.find((item) => item.id === id)?.invite_id ? { ...invite, status: "approved" } : invite));
    onBranchCreated(result.branch);
  }

  return <>
    <div className="page-heading"><div><span className="eyebrow">REMOTE BRANCH ONBOARDING</span><h1>Branch setup links</h1><p>Collect accurate office details from a manager before creating the branch.</p></div><button className="button button-primary" onClick={() => setModalOpen(true)}><Link2 size={17} /> Generate setup link</button></div>
    <div className="setup-flow-strip"><div><span>1</span><div><strong>Create a secure link</strong><small>Choose the branch name and attendance rule.</small></div></div><i /><div><span>2</span><div><strong>Manager captures details</strong><small>GPS, public IP and device information.</small></div></div><i /><div><span>3</span><div><strong>Review and approve</strong><small>The branch stays inactive until you approve it.</small></div></div></div>

    <div className="branch-setup-admin-grid">
      <section className="panel setup-review-panel"><div className="panel-head"><div><span className="eyebrow">NEEDS REVIEW</span><h2>{pending.length} captured setup{pending.length === 1 ? "" : "s"}</h2></div></div>
        <div className="setup-submission-list">{pending.length ? pending.map((submission) => <SubmissionCard key={submission.id} submission={submission} onApprove={() => approve(submission.id)} />) : <div className="empty-state"><span><Clipboard size={23} /></span><strong>No branch details waiting</strong><small>Generate a link and send it to the branch manager.</small></div>}</div>
      </section>
      <section className="panel setup-link-history"><div className="panel-head"><div><span className="eyebrow">LINK ACTIVITY</span><h2>Recent requests</h2></div></div><div className="invite-history">{invites.length ? invites.slice(0, 12).map((invite) => <div key={invite.id}><span className={`status-icon ${invite.status === "approved" ? "approved" : invite.status === "submitted" ? "present" : "late"}`}>{invite.status === "approved" ? <Check size={16} /> : <Link2 size={16} />}</span><div><strong>{invite.proposed_name}</strong><small>{invite.proposed_code} · expires {formatDistanceToNow(parseISO(invite.expires_at), { addSuffix: true })}</small></div><span className={`status-badge ${invite.status === "submitted" ? "pending" : invite.status}`}>{invite.status}</span></div>) : <div className="empty-state"><span><Link2 size={22} /></span><strong>No links generated</strong><small>Your secure setup links will appear here.</small></div>}</div></section>
    </div>
    <div className="browser-limit-banner"><Wifi size={20} /><div><strong>About Wi-Fi names</strong><span>Browsers cannot read the SSID. The manager is asked to copy it from device Wi-Fi settings; the public IP is detected by the server and cannot be typed manually.</span></div></div>
    {modalOpen && <SetupLinkModal onClose={() => setModalOpen(false)} onCreated={(invite) => setInvites((current) => [invite, ...current])} />}
  </>;
}

function SubmissionCard({ submission, onApprove }: { submission: BranchSetupSubmission & { approving?: boolean }; onApprove: () => void }) {
  const invite = submission.invite;
  const mapUrl = `https://www.openstreetmap.org/?mlat=${submission.latitude}&mlon=${submission.longitude}#map=19/${submission.latitude}/${submission.longitude}`;
  const sampleCount = nestedNumber(submission.device_info, "verifiedLocationEvidence", "sampleCount")
    ?? nestedNumber(submission.device_info, "finalLocationEvidence", "sampleCount")
    ?? nestedNumber(submission.device_info, "initialLocation", "sampleCount");
  const captureDurationMs = nestedNumber(submission.device_info, "finalLocationEvidence", "captureDurationMs")
    ?? nestedNumber(submission.device_info, "initialLocation", "captureDurationMs");
  const consensusCount = nestedNumber(submission.device_info, "verifiedLocationEvidence", "consensusCount")
    ?? nestedNumber(submission.device_info, "finalLocationEvidence", "consensusCount");
  const pinAdjustmentM = directNumber(submission.device_info, "initialPinAdjustmentM");
  const pinAdjusted = submission.device_info?.pinAdjusted === true;
  return <article className="setup-submission-card">
    <div className="submission-map-preview"><div className="map-grid" /><span className="map-radius" /><span className="map-pin"><MapPin size={20} /></span><a href={mapUrl} target="_blank" rel="noreferrer">Open map <ArrowUpRight size={13} /></a></div>
    <div className="submission-content"><div className="submission-title"><span className="branch-letter">{invite?.proposed_code.slice(0, 2)}</span><div><h3>{invite?.proposed_name || "Proposed branch"}</h3><p>{submission.address}</p></div><span className="status-badge pending">review</span></div>
      <div className="submission-facts"><Fact icon={<MapPin />} label="Location evidence" value={`±${submission.accuracy_m} m${consensusCount && sampleCount ? ` · ${consensusCount}/${sampleCount} agree` : sampleCount ? ` · ${sampleCount} samples` : ""}${captureDurationMs ? ` · ${(captureDurationMs / 1000).toFixed(1)}s` : ""}`} /><Fact icon={<ShieldCheck />} label="Map pin" value={pinAdjusted ? `Manager adjusted ${Math.round(pinAdjustmentM ?? 0)} m and confirmed` : "GPS pin confirmed by manager"} /><Fact icon={<Router />} label="Public IP" value={`${submission.public_ip} (server verified)`} /><Fact icon={<Wifi />} label="Wi-Fi name" value={`${submission.wifi_name} (manager entered)`} /><Fact icon={<Network />} label="Browser network" value={submission.connection_type || submission.effective_type || "Not exposed by browser"} /><Fact icon={<Smartphone />} label="Device" value={String(submission.device_info?.platform || "Unknown device")} /><Fact icon={<UserRound />} label="Submitted by" value={`${submission.manager_name} · ${submission.manager_phone}`} /></div>
      {submission.notes && <div className="submission-note">“{submission.notes}”</div>}
      <div className="submission-footer"><span><Clock3 size={14} /> Received {formatDistanceToNow(parseISO(submission.submitted_at), { addSuffix: true })}</span><button className="button button-primary" onClick={onApprove} disabled={submission.approving}>{submission.approving ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} Approve & create branch</button></div>
    </div>
  </article>;
}

function directNumber(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedNumber(record: Record<string, unknown> | undefined, parent: string, key: string) {
  const nested = record?.[parent];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  return directNumber(nested as Record<string, unknown>, key);
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div><span>{icon}</span><p><small>{label}</small><strong>{value}</strong></p></div>;
}

function SetupLinkModal({ onClose, onCreated }: { onClose: () => void; onCreated: (invite: BranchSetupInvite) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [created, setCreated] = useState<BranchSetupInvite | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError("");
    const response = await fetch("/api/admin/branch-invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const result = await response.json();
    if (!response.ok) { setError(result.error); setLoading(false); return; }
    setLink(result.link); setCreated(result.invite); onCreated(result.invite); setLoading(false);
  }
  async function copy() { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
  async function share() { if (navigator.share) await navigator.share({ title: `Set up ${created?.proposed_name}`, text: "Open this secure one-time link while connected to the office Wi-Fi.", url: link }); else await copy(); }

  return <div className="modal-backdrop"><div className="modal setup-link-modal"><div className="modal-head"><div><span className="eyebrow">ONE-TIME COLLECTION LINK</span><h2>{link ? "Link ready to send" : "Get branch details"}</h2><p>{link ? "Only share this with the intended branch manager." : "The branch will only be created after your review."}</p></div><button className="icon-button bordered" onClick={onClose}><X size={20} /></button></div>
    {!link ? <form onSubmit={submit} className="form-grid"><label className="field"><span>Proposed branch name</span><input name="proposed_name" required placeholder="Galle Branch" /></label><label className="field"><span>Branch code</span><input name="proposed_code" required minLength={2} maxLength={8} placeholder="GLE" /></label><label className="field"><span>Attendance radius</span><select name="radius_m" defaultValue="200"><option value="100">100 metres</option><option value="150">150 metres</option><option value="200">200 metres</option><option value="300">300 metres</option><option value="500">500 metres</option></select></label><label className="field"><span>Verification rule</span><select name="verification_mode" defaultValue="gps_and_ip">{Object.entries(verificationModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field field-span"><span>Link validity</span><select name="expires_in_hours" defaultValue="48"><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></label>{error && <div className="form-alert error field-span">{error}</div>}<div className="modal-actions field-span"><button type="button" className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Generate secure link</button></div></form>
      : <div className="generated-link"><span className="generated-icon"><ShieldCheck size={27} /></span><h3>{created?.proposed_name}</h3><p>This link expires {created && formatDistanceToNow(parseISO(created.expires_at), { addSuffix: true })} and accepts one submission.</p><div className="link-copy-row"><input readOnly value={link} /><button onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied" : "Copy"}</button></div><div className="share-instructions"><strong>Message for the branch manager</strong><ol><li>Open the link on a phone while inside the office.</li><li>Connect to office Wi-Fi and disable VPN/mobile data.</li><li>Tap Capture automatically, confirm the Wi-Fi name and submit.</li></ol></div><div className="modal-actions"><button className="button button-ghost" onClick={onClose}>Done</button><button className="button button-primary" onClick={share}><Send size={16} /> Share link</button></div></div>}
  </div></div>;
}
