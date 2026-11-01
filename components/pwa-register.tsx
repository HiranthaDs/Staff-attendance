"use client";

import { useEffect } from "react";

export type PresenceInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window { __presenceInstallPrompt?: PresenceInstallPrompt; }
}

export function PwaRegister() {
  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      window.__presenceInstallPrompt = event as PresenceInstallPrompt;
      window.dispatchEvent(new CustomEvent("presence:install-ready"));
    };
    const installed = () => {
      window.__presenceInstallPrompt = undefined;
      window.localStorage.setItem("presence:pwa-installed-at", String(Date.now()));
      window.dispatchEvent(new CustomEvent("presence:app-installed"));
      if ("storage" in navigator && "persist" in navigator.storage) void navigator.storage.persist().catch(() => false);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", installed);

    let update: (() => void) | undefined;
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((registration) => {
        let lastUpdate = 0;
        update = () => {
          if (!navigator.onLine || Date.now() - lastUpdate < 60 * 60_000) return;
          lastUpdate = Date.now();
          void registration.update().catch(() => undefined);
        };
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) window.dispatchEvent(new CustomEvent("presence:pwa-update"));
          });
        });
        update();
      }).catch(() => undefined);
    }
    const resume = () => { if (document.visibilityState === "visible") update?.(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", installed);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, []);
  return null;
}
