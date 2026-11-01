import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, MapPin, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "Secure office attendance and leave management",
  description: "Presence gives organizations secure location-verified attendance, staff calendars, leave workflows and multi-branch workforce reporting.",
  alternates: { canonical: "/about" },
  robots: { index: true, follow: true, noarchive: false },
};

const faq = [
  { question: "How does Presence verify office attendance?", answer: "Presence uses fresh device location samples, a short-lived server challenge and the saved branch radius. The server calculates the result and records an audit trail." },
  { question: "Can staff review previous attendance?", answer: "Yes. Each staff member has a calendar that securely loads their own attendance, leave, holidays and work schedule month by month." },
  { question: "Does Presence support multiple branches?", answer: "Yes. Companies can manage separate branches, attendance zones, schedules and administrators while keeping each company workspace isolated." },
];

export default function AboutPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "SoftwareApplication", name: "Presence", applicationCategory: "BusinessApplication", operatingSystem: "Web, Android, iOS", description: "Secure office attendance, leave and workforce operations for multi-branch organizations.", featureList: ["Location-verified attendance", "Staff attendance calendar", "Leave workflow", "Multi-branch dashboard", "Installable progressive web app"] },
      { "@type": "FAQPage", mainEntity: faq.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) },
    ],
  };
  return <main className="about-page"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} /><header><Brand /><Link className="button button-ghost" href="/login">Client sign in</Link></header><section className="about-hero"><span className="eyebrow">ATTENDANCE YOU CAN TRUST</span><h1>Every workday,<br />clear and accountable.</h1><p>Presence brings verified attendance, leave, staff calendars and multi-branch operations into one fast mobile-first workspace.</p><Link className="button button-primary button-lg" href="/login">Open your workspace <ArrowRight size={18} /></Link></section><section className="about-feature-grid"><article><MapPin /><h2>Verified attendance</h2><p>Fresh location consensus, one-time server challenges, branch-radius checks and a complete audit trail.</p></article><article><CalendarCheck /><h2>One work calendar</h2><p>Attendance history, work schedules, approved leave, holidays and notes remain understandable at a glance.</p></article><article><ShieldCheck /><h2>Tenant-safe control</h2><p>Company isolation, role-based access, personalized activation links and secure long-lived sessions.</p></article></section><section className="about-faq"><span className="eyebrow">QUICK ANSWERS</span><h2>Frequently asked questions</h2>{faq.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</section></main>;
}
