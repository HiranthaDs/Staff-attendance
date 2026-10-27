"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function UpdatePasswordForm({ firstLogin = false }: { firstLogin?: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The passwords do not match.");
    setLoading(true);
    const response = await fetch("/api/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const json = await response.json();
    if (!response.ok) { setError(json.error); setLoading(false); return; }
    await createClient().auth.refreshSession();
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="auth-form-wrap">
      <div className="auth-heading"><span className="eyebrow">{firstLogin ? "FIRST SIGN IN" : "ACCOUNT SECURITY"}</span><h2>Create a new password</h2><p>Choose a strong password you don’t use anywhere else.</p></div>
      <form onSubmit={submit} className="stack-lg">
        <label className="field"><span>New password</span><span className="input-shell"><KeyRound size={18} /><input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" /></span></label>
        <label className="field"><span>Confirm password</span><span className="input-shell"><KeyRound size={18} /><input type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat new password" /></span></label>
        {error && <div className="form-alert error">{error}</div>}
        <button className="button button-primary button-lg button-full" disabled={loading}>{loading ? <span className="spinner" /> : "Save password"}</button>
      </form>
    </div>
  );
}
