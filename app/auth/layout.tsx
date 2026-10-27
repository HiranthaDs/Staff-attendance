import { Brand } from "@/components/brand";

export default function AccountAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand light />
        <div className="auth-story-copy">
          <span className="eyebrow eyebrow-light">SECURE BY DEFAULT</span>
          <h1>Your account,<br />protected.</h1>
          <p>Use a unique password to keep your attendance and personal information safe.</p>
        </div>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  );
}
