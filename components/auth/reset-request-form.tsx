"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function ResetRequestForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=/auth/update-password`;
    await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="auth-form-wrap">
      <Link href="/login" className="back-link"><ArrowLeft size={16} /> Back to sign in</Link>
      <div className="auth-heading">
        <span className="eyebrow">ACCOUNT RECOVERY</span>
        <h2>{sent ? "Check your inbox" : "Reset your password"}</h2>
        <p>{sent ? "If that email belongs to an active account, we sent a secure reset link." : "Enter your work email and we’ll send you a secure reset link."}</p>
      </div>
      {!sent && <form onSubmit={submit} className="stack-lg"><label className="field"><span>Email address</span><span className="input-shell"><Mail size={18} /><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></span></label><button className="button button-primary button-lg button-full" disabled={loading}>{loading ? <span className="spinner" /> : "Send reset link"}</button></form>}
    </div>
  );
}
