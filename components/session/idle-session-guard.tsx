"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Clock3, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const IDLE_LIMIT_MS = 10 * 60 * 1_000;
const WARNING_MS = 60 * 1_000;
const STORAGE_KEY = "presence:last-active-at";

export function IdleSessionGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastWritten = useRef(0);
  const isPortal = pathname === "/app" || pathname === "/admin" || pathname === "/profile" || pathname.startsWith("/admin/");

  useEffect(() => {
    if (!isPortal) return;
    let signingOut = false;
    const touch = () => {
      const now = Date.now();
      if (now - lastWritten.current < 15_000) return;
      lastWritten.current = now;
      window.localStorage.setItem(STORAGE_KEY, String(now));
      setSecondsLeft(null);
    };
    const initial = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(initial) && initial > 0 && Date.now() - initial > IDLE_LIMIT_MS) {
      signingOut = true;
      void createClient().auth.signOut().finally(() => router.replace("/login?error=session_expired"));
    } else {
      touch();
    }
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((event) => window.addEventListener(event, touch, { passive: true }));
    const timer = window.setInterval(async () => {
      const lastActive = Number(window.localStorage.getItem(STORAGE_KEY)) || Date.now();
      const remaining = IDLE_LIMIT_MS - (Date.now() - lastActive);
      if (remaining <= 0 && !signingOut) {
        signingOut = true;
        window.localStorage.removeItem(STORAGE_KEY);
        await createClient().auth.signOut();
        router.replace("/login?error=session_expired");
        return;
      }
      setSecondsLeft(remaining <= WARNING_MS ? Math.max(1, Math.ceil(remaining / 1_000)) : null);
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, touch));
    };
  }, [isPortal, router]);

  if (secondsLeft === null) return null;
  return <aside className="session-warning" role="alertdialog" aria-live="assertive">
    <span><Clock3 size={20} /></span>
    <div><strong>Still working?</strong><small>Your secure session locks in {secondsLeft}s after 10 minutes without activity.</small></div>
    <button onClick={() => { const now = Date.now(); lastWritten.current = now; window.localStorage.setItem(STORAGE_KEY, String(now)); setSecondsLeft(null); }}><ShieldCheck size={16} /> Continue session</button>
  </aside>;
}
