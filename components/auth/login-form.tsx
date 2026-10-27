"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

export function LoginForm({ initialErrorCode = "", nextPath = "/" }: { initialErrorCode?: string; nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const initialError = initialErrorCode === "account_disabled"
    ? "This account has been disabled."
    : initialErrorCode === "session_expired"
      ? "Your secure session was renewed. Sign in again to continue."
      : "";
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || "Sign in failed. Please try again.");
        return;
      }
      const destination = nextPath === "/"
        ? typeof result.redirectTo === "string" ? result.redirectTo : "/"
        : nextPath;
      router.replace(destination);
      router.refresh();
    } catch {
      setError("The sign-in service could not be reached. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-form-wrap">
      <div className="auth-heading">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>Sign in to your workspace</h2>
        <p>Use the account provided by your administrator.</p>
      </div>
      <form onSubmit={submit} className="stack-lg">
        <label className="field">
          <span>Email address</span>
          <span className="input-shell"><Mail size={18} /><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></span>
        </label>
        <label className="field">
          <span className="field-line"><span>Password</span><Link href="/forgot-password">Forgot password?</Link></span>
          <span className="input-shell"><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" /><button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        {error && <div className="form-alert error" role="alert">{error}</div>}
        <button className="button button-primary button-lg button-full" disabled={loading}>{loading ? <span className="spinner" /> : <>Sign in <ArrowRight size={18} /></>}</button>
      </form>
      <p className="auth-help">Need access? Contact your office administrator.</p>
    </div>
  );
}
