"use client";

import { useEffect } from "react";

export type PresenceInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __presenceInstallPrompt?: PresenceInstallPrompt;
  }
}

export function PwaRegister() {
  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      window.__presenceInstallPrompt = event as PresenceInstallPrompt;
      window.dispatchEvent(new CustomEvent("presence:install-ready"));
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }
    return () => window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);
  return null;
}
