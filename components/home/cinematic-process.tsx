"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowRight,
  BellRing,
  Building2,
  CalendarCheck2,
  Check,
  CircleDollarSign,
  Gauge,
  KeyRound,
  MapPinCheckInside,
  Pause,
  Play,
  Send,
  ShieldCheck,
  Smartphone,
  UserRoundCheck,
} from "lucide-react";

const sceneDuration = 5_800;

const scenes = [
  {
    number: "01",
    label: "Platform access",
    title: "The operator enters through a dedicated security boundary.",
    text: "Presence verifies the Supabase session, active profile and super-admin role before any platform data is loaded.",
  },
  {
    number: "02",
    label: "Company setup",
    title: "A clean workspace is created with its own limits and owner.",
    text: "The operator defines the company, plan and capacity. Every record is attached to that isolated organization.",
  },
  {
    number: "03",
    label: "Secure handoff",
    title: "The company owner receives a one-time activation path.",
    text: "The invitation expires, can only be used once and never carries a password. The owner chooses their own credentials.",
  },
  {
    number: "04",
    label: "Workplace rules",
    title: "Branches, schedules and the real office radius are mapped.",
    text: "Each branch gets its location, time zone, attendance radius, grace period and the schedules its team follows.",
  },
  {
    number: "05",
    label: "Daily attendance",
    title: "An employee clocks in with a fresh location check.",
    text: "A short-lived challenge and server-side distance calculation turn the phone reading into a trusted attendance event.",
  },
  {
    number: "06",
    label: "Operational clarity",
    title: "Attendance becomes a useful, connected workday record.",
    text: "Live status feeds calendars, leave decisions, notifications, payroll preparation and company-level reporting.",
  },
] as const;

function subscribeToReducedMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function SceneArtwork({ scene }: { scene: number }) {
  if (scene === 0) {
    return (
      <div className="cinema-art cinema-access">
        <div className="cinema-login-card">
          <span className="cinema-mini-brand"><i /><strong>Presence</strong></span>
          <small>SUPER ADMIN PORTAL</small>
          <h3>Manage the platform</h3>
          <div className="cinema-input"><span>@</span><i /></div>
          <div className="cinema-input"><KeyRound size={13} /><i /></div>
          <div className="cinema-submit">Verify platform access <ArrowRight size={13} /></div>
        </div>
        <div className="cinema-float-card cinema-role-card"><ShieldCheck size={17} /><span><small>ROLE CHECK</small><strong>Super admin</strong></span><Check size={15} /></div>
        <div className="cinema-float-card cinema-audit-card"><span className="cinema-pulse-dot" /><span><small>SECURITY LEDGER</small><strong>Attempt recorded</strong></span></div>
      </div>
    );
  }

  if (scene === 1) {
    return (
      <div className="cinema-art cinema-company">
        <div className="cinema-window">
          <div className="cinema-window-bar"><span><i /><i /><i /></span><small>PLATFORM / COMPANIES</small><span className="cinema-live">LIVE</span></div>
          <div className="cinema-company-grid">
            <div className="cinema-company-form">
              <span className="cinema-icon-tile"><Building2 size={19} /></span>
              <small>NEW WORKSPACE</small><strong>Northstar Studio</strong>
              <div><i /><i className="short" /></div>
              <button type="button" tabIndex={-1}>Create company <ArrowRight size={12} /></button>
            </div>
            <div className="cinema-company-result">
              <small>WORKSPACE CREATED</small>
              <span className="cinema-big-check"><Check size={25} /></span>
              <strong>Northstar Studio</strong>
              <p><span>Growth plan</span><span>100 seats</span><span>Active</span></p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (scene === 2) {
    return (
      <div className="cinema-art cinema-handoff">
        <div className="cinema-flow-node platform"><Building2 size={19} /><span><small>PLATFORM</small><strong>Workspace ready</strong></span></div>
        <div className="cinema-flow-line"><i /><Send size={18} /></div>
        <div className="cinema-invite-card">
          <span><small>ONE-TIME OWNER LINK</small><strong>Activate your workspace</strong></span>
          <div className="cinema-link-line"><i /><i /><KeyRound size={14} /></div>
          <p><span>Expires in 24 hours</span><span>Single use</span></p>
        </div>
        <div className="cinema-flow-line second"><i /><Check size={17} /></div>
        <div className="cinema-flow-node owner"><UserRoundCheck size={19} /><span><small>COMPANY OWNER</small><strong>Account protected</strong></span></div>
      </div>
    );
  }

  if (scene === 3) {
    return (
      <div className="cinema-art cinema-map-scene">
        <div className="cinema-map">
          <div className="cinema-street horizontal one" /><div className="cinema-street horizontal two" />
          <div className="cinema-street vertical one" /><div className="cinema-street vertical two" />
          <span className="cinema-radius"><i><MapPinCheckInside size={27} /></i></span>
          <span className="cinema-map-tag">Colombo HQ · 150 m</span>
        </div>
        <div className="cinema-rule-stack">
          <small>BRANCH RULES</small>
          <div><span>09:00</span><p><strong>Start time</strong><small>15 min grace</small></p><Check size={14} /></div>
          <div><span>+05:30</span><p><strong>Time zone</strong><small>Asia / Colombo</small></p><Check size={14} /></div>
          <div><span>150 m</span><p><strong>Office radius</strong><small>Server verified</small></p><Check size={14} /></div>
        </div>
      </div>
    );
  }

  if (scene === 4) {
    return (
      <div className="cinema-art cinema-clock-scene">
        <div className="cinema-phone">
          <div className="cinema-phone-speaker" />
          <span className="cinema-phone-brand"><i /> Presence</span>
          <small>MONDAY · 8:57 AM</small>
          <strong>Good morning,<br />you&apos;re at the office.</strong>
          <div className="cinema-location-rings"><span><MapPinCheckInside size={24} /></span></div>
          <button type="button" tabIndex={-1}>Clock in <ArrowRight size={13} /></button>
        </div>
        <div className="cinema-verification-track">
          <div><span>1</span><p><strong>Fresh location</strong><small>Accuracy accepted</small></p><Check size={14} /></div>
          <i />
          <div><span>2</span><p><strong>One-time challenge</strong><small>Server validated</small></p><Check size={14} /></div>
          <i />
          <div><span>3</span><p><strong>Inside 150 m</strong><small>Clock-in recorded</small></p><Check size={14} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="cinema-art cinema-operations">
      <div className="cinema-ops-window">
        <div className="cinema-window-bar"><span><i /><i /><i /></span><small>COMPANY / TODAY</small><span className="cinema-live">LIVE</span></div>
        <div className="cinema-ops-grid">
          <div className="cinema-ops-hero"><small>WORKFORCE PULSE</small><strong>Everyone, in context.</strong><div className="cinema-bars"><i /><i /><i /><i /><i /><i /><i /></div></div>
          <div className="cinema-kpi"><Gauge size={17} /><span><small>PRESENT</small><strong>Live status</strong></span></div>
          <div className="cinema-kpi"><CalendarCheck2 size={17} /><span><small>LEAVE</small><strong>Decisions linked</strong></span></div>
          <div className="cinema-kpi"><CircleDollarSign size={17} /><span><small>PAYROLL</small><strong>Period ready</strong></span></div>
          <div className="cinema-kpi"><BellRing size={17} /><span><small>ALERTS</small><strong>Teams informed</strong></span></div>
        </div>
      </div>
    </div>
  );
}

export function CinematicProcess() {
  const [activeScene, setActiveScene] = useState(0);
  const [wantsToPlay, setWantsToPlay] = useState(true);
  const [motionOverride, setMotionOverride] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, reducedMotionSnapshot, () => true);
  const isPlaying = wantsToPlay && (!reducedMotion || motionOverride);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setTimeout(
      () => setActiveScene((scene) => (scene + 1) % scenes.length),
      sceneDuration,
    );
    return () => window.clearTimeout(timer);
  }, [activeScene, isPlaying]);

  const scene = scenes[activeScene];

  function togglePlayback() {
    if (isPlaying) {
      setWantsToPlay(false);
      return;
    }
    setMotionOverride(true);
    setWantsToPlay(true);
  }

  return (
    <section className="home-cinema-section" id="workflow" aria-labelledby="cinema-title">
      <div className="home-cinema-heading">
        <div>
          <span className="eyebrow">THE COMPLETE PRESENCE FLOW</span>
          <h2 id="cinema-title">See the workday unfold,<br /><em>scene by scene.</em></h2>
        </div>
        <p>This guided product demo follows the real handoff from platform setup to a verified clock-in and the records that follow.</p>
      </div>

      <div className="cinema-shell">
        <div className="cinema-screen" aria-live="polite">
          <div className="cinema-screen-topbar">
            <span className="cinema-demo-pill"><i /> GUIDED DEMO</span>
            <span>{scene.number} / {String(scenes.length).padStart(2, "0")}</span>
            <button type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause guided demo" : "Play guided demo"}>
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? "Pause" : "Play"}
            </button>
          </div>

          <div key={activeScene} className="cinema-scene">
            <SceneArtwork scene={activeScene} />
            <div className="cinema-caption">
              <span>{scene.label}</span>
              <h3>{scene.title}</h3>
              <p>{scene.text}</p>
            </div>
          </div>

          <div className="cinema-progress" aria-hidden="true">
            <span key={`${activeScene}-${isPlaying}`} className={isPlaying ? "playing" : ""} />
          </div>
        </div>

        <nav className="cinema-chapters" aria-label="Guided demo chapters">
          {scenes.map((item, index) => (
            <button
              type="button"
              key={item.number}
              className={index === activeScene ? "active" : ""}
              onClick={() => setActiveScene(index)}
              aria-current={index === activeScene ? "step" : undefined}
            >
              <span>{item.number}</span>
              <p><strong>{item.label}</strong><small>{index === activeScene ? "Now playing" : "View scene"}</small></p>
              <ArrowRight size={15} />
            </button>
          ))}
          <div className="cinema-chapter-note"><Smartphone size={16} /><p><strong>Designed for every screen</strong><small>The flow remains clear on mobile, tablet and desktop.</small></p></div>
        </nav>
      </div>
    </section>
  );
}
