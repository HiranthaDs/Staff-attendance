"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Building2, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";

type PublicInvitation = {
  full_name: string;
  invited_email: string;
  role: "company_admin" | "branch_admin" | "staff";
  job_title: string | null;
  status: string;
  expires_at: string;
  organization: { name: string; slug: string } | null;
  branch: { name: string; code: string } | null;
};

export function JoinWorkspaceForm({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [completeEmail, setCompleteEmail] = useState("");

  useEffect(() => {
    fetch(`/api/invitations/${encodeURIComponent(token)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (result.invitation) setInvitation(result.invitation);
      if (!response.ok) setError(result.error || "This invitation is no longer available.");
    }).catch(() => setError("The invitation service could not be reached.")).finally(() => setLoading(false));
  }, [token]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError("");
    const response = await fetch(`/api/invitations/${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password, confirm_password: confirmPassword }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error || "Your account could not be created."); setSubmitting(false); return; }
    setCompleteEmail(result.email); setSubmitting(false);
  }

  if (loading) return <div className="join-card join-loading"><LoaderCircle className="spin" size={28} /><p>Checking your secure invitation…</p></div>;
  if (completeEmail) return <div className="join-card join-complete"><Brand /><div className="credential-success-icon"><CheckCircle2 size={34} /></div><span className="eyebrow">ACCOUNT READY</span><h2>Welcome to {invitation?.organization?.name}</h2><p>Your account is active. Sign in with <strong>{completeEmail}</strong> and the password you just created.</p><Link className="button button-primary button-lg button-full" href={`/login/${encodeURIComponent(invitation?.organization?.slug || "")}?email=${encodeURIComponent(completeEmail)}`}>Continue to company sign in <ArrowRight size={18} /></Link></div>;
  if (!invitation || invitation.status !== "pending") return <div className="join-card"><Brand /><span className="eyebrow">INVITATION UNAVAILABLE</span><h2>This link cannot be used</h2><p>{error || "It may have expired, been revoked, or already been accepted."}</p><Link href="/login" className="button button-ghost button-full">Back to sign in</Link></div>;
  const requirements = [password.length >= 12, /[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];
  return <div className="join-card"><Brand /><div className="join-heading"><span className="eyebrow">YOU&apos;RE INVITED</span><h2>Join {invitation.organization?.name}</h2><p>Hi {invitation.full_name}. Create your password to activate your workspace account.</p></div><div className="invitation-summary"><span><Building2 size={18} /><div><small>Company</small><strong>{invitation.organization?.name}</strong></div></span>{invitation.branch && <span><MapPin size={18} /><div><small>Branch</small><strong>{invitation.branch.name}</strong></div></span>}<span><ShieldCheck size={18} /><div><small>Access</small><strong>{invitation.role === "company_admin" ? "Company owner" : invitation.role === "branch_admin" ? "Branch admin" : "Staff"}</strong></div></span></div><form className="stack-lg" onSubmit={submit}><label className="field"><span>Email address</span><input value={invitation.invited_email} readOnly /></label><label className="field"><span>Create password</span><span className="input-shell"><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label><div className="password-rules"><span className={requirements[0] ? "met" : ""}>12+ characters</span><span className={requirements[1] && requirements[2] ? "met" : ""}>Upper & lowercase</span><span className={requirements[3] ? "met" : ""}>A number</span><span className={requirements[4] ? "met" : ""}>A symbol</span></div><label className="field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>{error && <div className="form-alert error" role="alert">{error}</div>}<button className="button button-primary button-lg button-full" disabled={submitting || !requirements.every(Boolean) || password !== confirmPassword}>{submitting ? <><LoaderCircle className="spin" size={18} /> Creating account…</> : <>Create account <ArrowRight size={18} /></>}</button></form><p className="invite-expiry">Private link · expires {new Intl.DateTimeFormat("en-LK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(invitation.expires_at))}</p></div>;
}
