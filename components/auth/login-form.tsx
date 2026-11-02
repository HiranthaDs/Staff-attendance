"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { getOrCreateLoginDevice } from "@/lib/device-identity";

type LoginFormProps = {
  initialErrorCode?: string;
  nextPath?: string;
  initialEmail?: string;
  workspaceSlug?: string;
  workspaceName?: string;
  portal?: "company" | "platform" | "owner";
};

export function LoginForm({
  initialErrorCode = "",
  nextPath = "/",
  initialEmail = "",
  workspaceSlug = "",
  workspaceName = "",
  portal = "company",
}: LoginFormProps) {
  const router = useRouter();
  const isOwnerPortal = portal === "owner";
  const isPlatformPortal = portal === "platform" || isOwnerPortal;
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const initialError = initialErrorCode === "account_disabled"
    ? "This account has been disabled."
    : initialErrorCode === "company_suspended"
      ? "This company workspace is suspended. Contact the platform administrator."
    : initialErrorCode === "session_expired"
      ? "Your session ended. Sign in again to continue."
      : initialErrorCode === "device_required"
        ? "This attendance account needs its registered device. Sign in again from the authorized browser."
      : "";
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const [deviceEnrollmentRequired, setDeviceEnrollmentRequired] = useState(false);
  const [deviceEnrollmentCode, setDeviceEnrollmentCode] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading || retryAfter > 0) return;
    setLoading(true);
    setError("");
    try {
      const device = isPlatformPortal ? undefined : getOrCreateLoginDevice();
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          workspace: workspaceSlug || undefined,
          portal: isOwnerPortal ? "owner" : isPlatformPortal ? "platform" : "company",
          device,
          deviceEnrollmentCode: deviceEnrollmentRequired ? deviceEnrollmentCode : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || "Sign in failed. Please try again.");
        if (result.code === "device_enrollment_required" || result.code === "device_enrollment_expired") {
          setDeviceEnrollmentRequired(true);
        }
        if (response.status === 429) {
          const seconds = Number(result.retryAfter || response.headers.get("retry-after") || 60);
          setRetryAfter(Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 900)) : 60);
        }
        return;
      }
      let destination = nextPath === "/"
        ? typeof result.redirectTo === "string" ? result.redirectTo : "/"
        : nextPath;
      if (result.deviceStatus === "registered") {
        const registeredUrl = new URL(destination, window.location.origin);
        registeredUrl.searchParams.set("device", "registered");
        destination = `${registeredUrl.pathname}${registeredUrl.search}${registeredUrl.hash}`;
      }
      window.localStorage.setItem("presence:last-active-at", String(Date.now()));
      router.replace(destination);
      router.refresh();
    } catch {
      setError("The sign-in service could not be reached. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`auth-form-wrap${isPlatformPortal ? " auth-form-platform" : ""}`}>
      <div className="auth-heading">
        {isPlatformPortal && <span className="auth-security-badge"><ShieldCheck size={14} /> {isOwnerPortal ? "Private system-owner access" : "Protected platform access"}</span>}
        <span className="eyebrow">{isOwnerPortal ? "SYSTEM OWNER PORTAL" : isPlatformPortal ? "PLATFORM PORTAL" : workspaceName ? `${workspaceName.toUpperCase()} PORTAL` : "COMPANY ACCESS"}</span>
        <h2>{isOwnerPortal ? "Run the entire platform" : isPlatformPortal ? "Manage the platform" : workspaceName ? `Sign in to ${workspaceName}` : "Sign in to your company"}</h2>
        <p>{isOwnerPortal ? "Reserved for the system builder. Company super admins and employees cannot sign in here." : isPlatformPortal ? "Use your dedicated platform account. Company accounts are intentionally blocked from this portal." : workspaceName ? "This secure link accepts accounts belonging to this company." : "Company super admins, branch administrators, and employees can sign in here with their activated account."}</p>
      </div>
      <form onSubmit={submit} className="stack-lg" aria-busy={loading} noValidate={false}>
        <label className="field">
          <span>Email address</span>
          <span className="input-shell"><Mail size={18} /><input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" maxLength={254} required disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} value={email} onChange={(event) => setEmail(event.target.value)} placeholder={isPlatformPortal ? "admin@platform.com" : "you@company.com"} /></span>
        </label>
        {deviceEnrollmentRequired && !isPlatformPortal && (
          <label className="field device-enrollment-field">
            <span>New device registration code</span>
            <span className="input-shell"><KeyRound size={18} /><input value={deviceEnrollmentCode} onChange={(event) => setDeviceEnrollmentCode(event.target.value.toUpperCase())} minLength={8} maxLength={40} autoComplete="one-time-code" required disabled={loading} placeholder="XXXX-XXXX-XXXX" /></span>
            <small>Enter the one-time code issued by the super admin after resetting this account&apos;s registered device.</small>
          </label>
        )}
        <label className="field">
          <span className="field-line"><span>Password</span><Link href="/forgot-password">Forgot password?</Link></span>
          <span className="input-shell"><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" maxLength={128} required disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button type="button" className="icon-button" onClick={() => setShowPassword((visible) => !visible)} disabled={loading} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
        </label>
        {error && <div ref={errorRef} id="login-error" className="form-alert error" role="alert" tabIndex={-1}>{error}</div>}
        <button type="submit" className="button button-primary button-lg button-full" disabled={loading || retryAfter > 0}>
          {loading ? <><span className="spinner" /> Verifying access</> : retryAfter > 0 ? `Try again in ${Math.ceil(retryAfter / 60)} min` : <>Sign in securely <ArrowRight size={18} /></>}
        </button>
      </form>
      {isPlatformPortal && (
        <div className="auth-platform-assurance" aria-label="Platform login protections">
          <span><KeyRound size={14} /> Dedicated role check</span>
          <span><ShieldCheck size={14} /> Attempt protection</span>
        </div>
      )}
      {isPlatformPortal ? (
        <div className="auth-portal-switch">
          <ShieldCheck size={18} />
          <p><span>Company super admin or employee?</span><Link href="/login">Go to company sign in</Link></p>
        </div>
      ) : workspaceName ? (
        <p className="auth-help">Need access? Contact your office administrator.</p>
      ) : (
        <div className="auth-entry-help">
          <p><span>New company super admin?</span> Create your company and administrator account, or use the private activation link sent by the system owner.</p>
          <Link className="button button-primary button-full" href="/signup">Create company super-admin account <ArrowRight size={16} /></Link>
          <div className="auth-portal-switch">
            <ShieldCheck size={18} />
            <p><span>System owner?</span><Link href="/system-owner/login">Use the private owner portal</Link></p>
          </div>
        </div>
      )}
    </div>
  );
}
