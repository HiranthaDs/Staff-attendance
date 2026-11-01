"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Keep portal sessions alive until explicit logout, including PWA resumes. */
export function IdleSessionGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const isPortal = pathname === "/app" || pathname === "/admin" || pathname === "/profile"
    || pathname === "/super-admin" || pathname.startsWith("/admin/") || pathname.startsWith("/super-admin/");

  useEffect(() => {
    if (!isPortal) return;
    const client = createClient();
    let active = true;
    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (active && event === "SIGNED_OUT") router.replace("/login?error=session_expired");
    });
    const resume = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const { data } = await client.auth.getSession();
      if (!active || !data.session) return;
      const expiresSoon = (data.session.expires_at ?? 0) * 1_000 - Date.now() < 5 * 60_000;
      if (expiresSoon) await client.auth.refreshSession().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    void resume();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [isPortal, router]);

  return null;
}
