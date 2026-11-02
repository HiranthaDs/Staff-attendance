import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Download,
  Fingerprint,
  Gauge,
  KeyRound,
  Layers3,
  MapPinCheckInside,
  MessageSquareText,
  ShieldCheck,
  Smartphone,
  Users,
  WalletCards,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { CinematicProcess } from "@/components/home/cinematic-process";
import { getCurrentProfile } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Office attendance, leave and workforce operations",
  description: "Presence gives platform owners and companies secure location-verified attendance, direct staff login links, leave, payroll, schedules and multi-branch workforce control.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, noarchive: false },
  openGraph: {
    title: "Presence | Every workday, clearly managed",
    description: "One secure platform for company setup, branch attendance, staff calendars, leave, payroll and workforce reporting.",
    url: "/",
  },
};

const capabilities = [
  {
    icon: MapPinCheckInside,
    title: "Location-verified attendance",
    text: "Fresh high-accuracy location readings, a one-time server challenge and the saved office radius verify every clock-in and clock-out.",
  },
  {
    icon: Layers3,
    title: "Multi-company platform",
    text: "Create isolated company workspaces, set plans and staff limits, appoint owners, and suspend or reactivate access from one platform view.",
  },
  {
    icon: Building2,
    title: "Branch operations",
    text: "Manage branches, map-based office zones, local time zones, grace periods and branch administrators without mixing company data.",
  },
  {
    icon: CalendarDays,
    title: "Calendars and leave",
    text: "Bring work schedules, attendance history, holidays, company notes and full- or half-day leave requests into one clear calendar.",
  },
  {
    icon: Users,
    title: "Complete staff records",
    text: "Maintain employment status, department, schedule, emergency contact, leave allowances, account state and employee lifecycle details.",
  },
  {
    icon: WalletCards,
    title: "Payroll-ready records",
    text: "Calculate attendance periods, lateness, leave, deductions, allowances, EPF and ETF, then export clear branch and payroll ledgers.",
  },
  {
    icon: BellRing,
    title: "Useful notifications",
    text: "Keep teams informed with an in-app inbox, push reminders, leave decisions, calendar updates and start- or finish-time alerts.",
  },
  {
    icon: MessageSquareText,
    title: "Support and accountability",
    text: "Staff can report attendance, schedule, payroll or app issues while administrators track them through resolution.",
  },
  {
    icon: Smartphone,
    title: "Installable mobile experience",
    text: "Presence works as a responsive PWA on phones and desktops, with safe update handling and an offline fallback for unavailable pages.",
  },
];

const roles = [
  { label: "Platform", title: "Super admin", text: "Controls companies, plans, capacity, owner access, platform activity, public holidays and support hotlines." },
  { label: "Company", title: "Company owner", text: "Runs branches, employees, schedules, leave, attendance, payroll, exports and company settings." },
  { label: "Branch", title: "Branch admin", text: "Supports assigned branch operations and staff within the permissions granted by the company." },
  { label: "Personal", title: "Employee", text: "Clocks in and out, reviews their calendar, requests leave, receives alerts and manages their own profile." },
];

const securityPoints = [
  "Server-side distance checks against the saved branch radius",
  "Short-lived, single-use attendance challenges",
  "Tenant-aware database policies that isolate company data",
  "One registered attendance browser per staff account",
  "Hashed, expiring and one-time account activation links",
  "Role checks at protected pages, APIs and data operations",
  "Persistent secure sessions with password-reset protection",
];

const faq = [
  {
    question: "Where do employees sign in?",
    answer: "Employees do not need to use this homepage. Each company has a personalized sign-in URL that the company owner sends directly to staff. After sign-in, Presence routes them straight to their employee portal.",
  },
  {
    question: "Is the super-admin login separate?",
    answer: "Yes. The platform super admin uses the dedicated platform login. Company owners, branch administrators and employees use their company sign-in page instead.",
  },
  {
    question: "How is attendance verified?",
    answer: "At clock-in or clock-out, Presence collects fresh high-accuracy browser location readings. The server checks their freshness and accuracy, calculates the distance to the assigned branch, and accepts the mark only inside the configured radius.",
  },
  {
    question: "Does Presence track staff all day?",
    answer: "No. Location verification happens when an employee submits a clock-in or clock-out. Attendance does not rely on Wi-Fi names or IP addresses.",
  },
  {
    question: "Can employees sign in for each other on the same phone?",
    answer: "No. Each attendance-capable account is bound to one registered browser credential, and one browser cannot be registered to multiple staff accounts. A super admin must reset access and issue a one-time code before an employee can move to a replacement device.",
  },
  {
    question: "Can one platform manage several companies and branches?",
    answer: "Yes. The super admin can manage multiple isolated companies, and every company can operate multiple branches with separate locations, schedules and administrators.",
  },
  {
    question: "What happens if a phone is offline?",
    answer: "The PWA provides an offline fallback, but attendance is never queued offline. A live connection is required so the server can verify location and prevent duplicated or delayed marks.",
  },
];

function HomePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Presence",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Android, iOS",
        description: "Secure office attendance, leave, payroll and workforce operations for multi-company and multi-branch organizations.",
        featureList: capabilities.map((item) => item.title),
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      },
    ],
  };

  return (
    <main className="home-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />

      <header className="home-header">
        <Brand />
        <nav aria-label="Homepage navigation">
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">Guided demo</a>
          <a href="#roles">Access</a>
          <a href="#security">Security</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link className="button button-dark home-header-login" href="/super-admin/login">
          Super admin login <ArrowRight size={16} />
        </Link>
      </header>

      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-kicker"><span /> OFFICE ATTENDANCE, WITHOUT THE FRICTION</span>
          <h1>Every company.<br /><em>One clear</em> workday.</h1>
          <p>Presence brings company setup, location-verified attendance, leave, schedules, payroll and staff communication into one secure platform.</p>
          <div className="home-hero-actions">
            <Link className="button button-primary button-lg" href="/super-admin/login">
              Sign in as super admin <ArrowRight size={18} />
            </Link>
            <a className="button button-ghost button-lg" href="#capabilities">Explore the platform</a>
          </div>
          <div className="home-hero-trust" aria-label="Platform highlights">
            <span><Check size={15} /> Direct company login links</span>
            <span><Check size={15} /> Multi-branch ready</span>
            <span><Check size={15} /> Installable PWA</span>
          </div>
        </div>

        <div className="home-product-preview" aria-label="Illustration of the Presence platform dashboard">
          <div className="home-preview-topbar">
            <span><i /><i /><i /></span>
            <strong>Platform overview</strong>
            <span className="home-live-pill"><i /> Live</span>
          </div>
          <div className="home-preview-grid">
            <article className="home-preview-primary">
              <div className="home-preview-title">
                <span><Gauge size={18} /></span>
                <div><small>TODAY</small><strong>Workforce pulse</strong></div>
              </div>
              <div className="home-preview-kpis">
                <div><span>Companies</span><strong>Isolated</strong><small>Secure workspaces</small></div>
                <div><span>Attendance</span><strong>Verified</strong><small>Office radius</small></div>
                <div><span>Operations</span><strong>Connected</strong><small>One clear view</small></div>
              </div>
              <div className="home-preview-chart" aria-hidden="true">
                <span style={{ height: "44%" }} /><span style={{ height: "67%" }} /><span style={{ height: "55%" }} />
                <span style={{ height: "83%" }} /><span style={{ height: "71%" }} /><span style={{ height: "92%" }} /><span style={{ height: "76%" }} />
              </div>
              <div className="home-preview-axis"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span><span>SAT</span><span>SUN</span></div>
            </article>
            <aside className="home-preview-side">
              <div className="home-mini-status">
                <span><Building2 size={17} /></span>
                <div><small>COMPANY CONTROL</small><strong>Ready to scale</strong></div>
                <Check size={16} />
              </div>
              <div className="home-company-list">
                <p><strong>Workspace status</strong><small>Live overview</small></p>
                <div><span className="home-company-mark lime">A</span><p><strong>Active company</strong><small>Branches connected</small></p><i /></div>
                <div><span className="home-company-mark lilac">B</span><p><strong>Growing team</strong><small>Capacity managed</small></p><i /></div>
                <div><span className="home-company-mark blue">C</span><p><strong>New workspace</strong><small>Owner invited</small></p><i /></div>
              </div>
              <div className="home-preview-note"><ShieldCheck size={17} /><span><strong>Tenant-safe by design</strong><small>Each company stays separate.</small></span></div>
            </aside>
          </div>
        </div>
      </section>

      <section className="home-direct-access" aria-labelledby="direct-access-title">
        <div className="home-direct-icon"><KeyRound size={24} /></div>
        <div>
          <span className="eyebrow">A SHORTER PATH FOR STAFF</span>
          <h2 id="direct-access-title">Employees go straight to their company login.</h2>
          <p>The super admin creates the company, then the company owner sends each employee the personalized sign-in link. Staff do not need a homepage or a platform-level login.</p>
        </div>
        <div className="home-link-example" aria-label="Example company login flow">
          <span>Company sign-in link</span>
          <strong>presence.app/login/your-company</strong>
          <small><Check size={13} /> Direct to the correct workspace</small>
        </div>
      </section>

      <CinematicProcess />

      <section className="home-section" id="capabilities">
        <div className="home-section-heading">
          <div><span className="eyebrow">COMPLETE WORKFORCE OPERATIONS</span><h2>Everything needed to run a clear workday.</h2></div>
          <p>From the platform owner to an individual employee, every role sees the tools and information it actually needs.</p>
        </div>
        <div className="home-capability-grid">
          {capabilities.map(({ icon: Icon, title, text }, index) => (
            <article key={title} className={index === 0 ? "featured" : ""}>
              <span><Icon size={21} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
              <small>{String(index + 1).padStart(2, "0")}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="home-section home-roles-section" id="roles">
        <div className="home-section-heading compact">
          <div><span className="eyebrow">CLEAR ACCESS AT EVERY LEVEL</span><h2>Four roles. No crossed wires.</h2></div>
          <p>Permissions follow responsibility, while sensitive actions remain protected on the server and in the database.</p>
        </div>
        <div className="home-role-grid">
          {roles.map((role, index) => (
            <article key={role.title}>
              <div><span>{role.label}</span><strong>0{index + 1}</strong></div>
              <h3>{role.title}</h3>
              <p>{role.text}</p>
            </article>
          ))}
        </div>
        <div className="home-operations-strip">
          <div><Clock3 size={20} /><span><strong>Attendance</strong><small>Clock-ins, clock-outs, lateness and missed days</small></span></div>
          <div><CalendarDays size={20} /><span><strong>Planning</strong><small>Schedules, holidays, notes and leave</small></span></div>
          <div><Download size={20} /><span><strong>Reporting</strong><small>Attendance ledgers and payroll exports</small></span></div>
          <div><BellRing size={20} /><span><strong>Communication</strong><small>Alerts, reminders and issue resolution</small></span></div>
        </div>
      </section>

      <section className="home-security-section" id="security">
        <div className="home-security-card">
          <div className="home-security-copy">
            <span className="home-kicker light"><span /> SECURITY BUILT INTO THE WORKFLOW</span>
            <h2>Trust the record,<br />not a shortcut.</h2>
            <p>Presence verifies attendance and access close to the data source. A hidden button or a client-side role check is never treated as the security boundary.</p>
            <ul>
              {securityPoints.map((point) => <li key={point}><Check size={15} /> {point}</li>)}
            </ul>
          </div>
          <div className="home-security-visual">
            <div className="home-security-orbit"><span><Fingerprint size={42} /></span></div>
            <div className="home-security-tag top"><ShieldCheck size={16} /><span><strong>Role verified</strong><small>At every protected action</small></span></div>
            <div className="home-security-tag bottom"><MapPinCheckInside size={16} /><span><strong>Location verified</strong><small>Fresh server-side decision</small></span></div>
          </div>
        </div>
      </section>

      <section className="home-faq-section" id="faq">
        <div className="home-faq-heading"><span className="eyebrow">COMMON QUESTIONS</span><h2>Before the first workday.</h2><p>The essentials for platform owners, company administrators and staff.</p></div>
        <div className="home-faq-list">
          {faq.map((item, index) => (
            <details key={item.question} open={index === 0}>
              <summary><span>{item.question}</span><i>+</i></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="home-final-cta">
        <div>
          <span className="eyebrow">PLATFORM ACCESS</span>
          <h2>Ready to manage the next workday?</h2>
          <p>Enter the secure platform portal to create companies, invite owners and oversee operations.</p>
        </div>
        <Link className="button button-dark button-lg" href="/super-admin/login">Super admin login <ArrowRight size={18} /></Link>
      </section>

      <footer className="home-footer">
        <Brand />
        <p>Secure attendance and workforce clarity for every office.</p>
        <div><a href="#capabilities">Capabilities</a><a href="#security">Security</a><Link href="/super-admin/login">Platform login</Link></div>
      </footer>
    </main>
  );
}

export default async function Home() {
  const profile = await getCurrentProfile().catch(() => null);

  if (profile) {
    const loginPath = profile.role === "super_admin" ? "/super-admin/login" : "/login";
    if (!profile.active) redirect(`${loginPath}?error=account_disabled`);
    if (profile.organization && profile.organization.status !== "active") redirect("/login?error=company_suspended");
    if (profile.must_reset_password) redirect("/auth/update-password");
    redirect(profile.role === "super_admin" ? "/super-admin" : profile.role === "company_admin" || profile.role === "branch_admin" ? "/admin" : "/app");
  }

  return <HomePage />;
}
