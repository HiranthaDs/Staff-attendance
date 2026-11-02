"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, MailCheck, ShieldCheck, Sparkles, UserRoundCheck } from "lucide-react";
import { Brand } from "@/components/brand";

export function CompanySignupForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ company: string; slug: string; email: string } | null>(null);
  const requirements = [password.length >= 12, /[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];

  function deriveSlug(value: string) {
    setSlug(value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (!requirements.every(Boolean) || password !== confirmPassword) {
      setError("Create a stronger password and make sure both password fields match.");
      return;
    }
    setLoading(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/company-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || "The company account could not be created.");
        return;
      }
      if (result.confirmationRequired) {
        setReceipt({ company: String(result.organization?.name || values.name), slug: String(result.organization?.slug || values.slug), email: String(result.email || values.admin_email) });
        return;
      }
      router.replace(typeof result.redirectTo === "string" ? result.redirectTo : "/admin");
      router.refresh();
    } catch {
      setError("The registration service could not be reached. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (receipt) return <main className="signup-complete-page"><div className="signup-complete-card"><Brand /><span className="signup-complete-icon"><MailCheck size={34} /></span><span className="eyebrow">VERIFY YOUR EMAIL</span><h1>{receipt.company} is almost ready.</h1><p>We sent a confirmation link to <strong>{receipt.email}</strong>. Open it to verify the company super-admin account, then use your permanent company sign-in page.</p><div className="signup-company-link"><small>COMPANY SIGN-IN</small><strong>{`${window.location.origin}/login/${receipt.slug}`}</strong></div><Link className="button button-primary button-lg button-full" href={`/login/${encodeURIComponent(receipt.slug)}?email=${encodeURIComponent(receipt.email)}`}>Continue to company sign in <ArrowRight size={18} /></Link><small className="signup-complete-help">Didn&apos;t receive it? Check spam or wait a minute before trying again.</small></div></main>;

  return <main className="company-signup-page">
    <aside className="company-signup-story">
      <Brand />
      <div>
        <span className="eyebrow"><Sparkles size={14} /> NEW COMPANY WORKSPACE</span>
        <h1>Your company.<br /><em>Ready in minutes.</em></h1>
        <p>Create the company record and its first super-admin account together. After signup, you can add branches, invite employees, and configure attendance.</p>
        <div className="signup-benefits">
          <span><Check size={16} /><strong>Dedicated company sign-in URL</strong></span>
          <span><Check size={16} /><strong>Company-scoped super-admin access</strong></span>
          <span><Check size={16} /><strong>Employee, attendance and payroll tools</strong></span>
        </div>
      </div>
      <div className="signup-owner-note"><ShieldCheck size={18} /><span><strong>Separate from the system owner</strong><small>Your account can only access your own company.</small></span></div>
    </aside>

    <section className="company-signup-main">
      <div className="company-signup-top"><Link href="/login"><ArrowLeft size={15} /> Company super-admin sign in</Link><small>Already registered?</small></div>
      <div className="company-signup-card">
        <div className="signup-heading"><span className="eyebrow">COMPANY SUPER ADMIN SIGN UP</span><h2>Create your company account</h2><p>Enter the official company information and the administrator who will manage it.</p></div>
        <form className="form-grid signup-form" onSubmit={submit}>
          <div className="signup-form-section field-span"><span><Building2 size={18} /></span><div><strong>Company details</strong><small>Official identity and company contact information</small></div><b>01</b></div>
          <label className="field"><span>Company display name</span><input name="name" minLength={2} maxLength={120} required onChange={(event) => deriveSlug(event.target.value)} placeholder="Acme Holdings" /></label>
          <label className="field"><span>Legal company name</span><input name="legal_name" minLength={2} maxLength={160} required placeholder="Acme Holdings (Pvt) Ltd" /></label>
          <label className="field"><span>Registration number</span><input name="registration_number" minLength={2} maxLength={80} pattern="[A-Za-z0-9 ./-]+" required placeholder="PV 123456" /></label>
          <label className="field"><span>Industry</span><input name="industry" minLength={2} maxLength={100} required placeholder="Technology, retail, logistics…" /></label>
          <label className="field"><span>Company phone</span><input name="company_phone" minLength={7} maxLength={30} required autoComplete="tel" placeholder="+94 11 234 5678" /></label>
          <label className="field"><span>Billing email</span><input name="billing_email" type="email" maxLength={254} required placeholder="accounts@company.com" /></label>
          <label className="field field-span"><span>Registered address</span><input name="address" minLength={4} maxLength={300} required autoComplete="street-address" placeholder="Street address" /></label>
          <label className="field"><span>City</span><input name="city" minLength={2} maxLength={100} required autoComplete="address-level2" placeholder="Colombo" /></label>
          <label className="field"><span>Country</span><input name="country" minLength={2} maxLength={100} defaultValue="Sri Lanka" required autoComplete="country-name" /></label>
          <label className="field"><span>Website <small>(optional)</small></span><input name="website" type="url" maxLength={240} placeholder="https://company.com" /></label>
          <label className="field"><span>Timezone</span><select name="timezone" defaultValue="Asia/Colombo" required><option value="Asia/Colombo">Asia/Colombo (Sri Lanka)</option><option value="Asia/Dubai">Asia/Dubai</option><option value="Asia/Singapore">Asia/Singapore</option><option value="Europe/London">Europe/London</option><option value="America/New_York">America/New York</option></select></label>
          <label className="field"><span>Company sign-in URL</span><div className="suffix-input"><input name="slug" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} minLength={3} maxLength={50} required /><span>workspace</span></div></label>
          <label className="field"><span>Starting plan</span><select name="plan" defaultValue="growth"><option value="starter">Starter · up to 50 users</option><option value="growth">Growth · up to 250 users</option><option value="scale">Scale · up to 1,000 users</option></select></label>

          <div className="signup-form-section field-span"><span><UserRoundCheck size={18} /></span><div><strong>Super-admin details</strong><small>The first administrator for this company</small></div><b>02</b></div>
          <label className="field"><span>Full name</span><input name="admin_name" minLength={2} maxLength={100} required autoComplete="name" /></label>
          <label className="field"><span>Email address</span><input name="admin_email" type="email" maxLength={254} required autoComplete="email" /></label>
          <label className="field"><span>Phone number</span><input name="admin_phone" minLength={7} maxLength={30} required autoComplete="tel" /></label>
          <label className="field"><span>Job title</span><input name="admin_job_title" minLength={2} maxLength={100} defaultValue="Company super admin" required /></label>

          <div className="signup-form-section field-span"><span><LockKeyhole size={18} /></span><div><strong>Secure access</strong><small>Create the password for your company super-admin login</small></div><b>03</b></div>
          <label className="field"><span>Password</span><span className="input-shell"><LockKeyhole size={17} /><input name="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" /><button type="button" className="icon-button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          <label className="field"><span>Confirm password</span><input name="confirm_password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} maxLength={128} required autoComplete="new-password" /></label>
          <div className="password-rules field-span"><span className={requirements[0] ? "met" : ""}>12+ characters</span><span className={requirements[1] && requirements[2] ? "met" : ""}>Upper & lowercase</span><span className={requirements[3] ? "met" : ""}>A number</span><span className={requirements[4] ? "met" : ""}>A symbol</span><span className={password && password === confirmPassword ? "met" : ""}>Passwords match</span></div>
          <label className="signup-honeypot" aria-hidden="true">Company fax<input name="company_fax" tabIndex={-1} autoComplete="off" /></label>
          {error && <div className="form-alert error field-span" role="alert">{error}</div>}
          <div className="signup-submit field-span"><p><ShieldCheck size={15} /> Your company data stays isolated from every other workspace.</p><button className="button button-primary button-lg" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} /> Creating workspace…</> : <>Create company & super admin <ArrowRight size={18} /></>}</button></div>
        </form>
      </div>
    </section>
  </main>;
}
