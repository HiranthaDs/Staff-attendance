import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand light />
        <div className="auth-story-copy">
          <span className="eyebrow eyebrow-light">ONE TAP. VERIFIED.</span>
          <h1>Workdays,<br />beautifully clear.</h1>
          <p>Accurate attendance and leave management across every office, without the morning friction.</p>
        </div>
        <div className="auth-proof">
          <span className="proof-dot" />
          <div><strong>Simple and reliable</strong><small>Location inside the office radius</small></div>
        </div>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  );
}
