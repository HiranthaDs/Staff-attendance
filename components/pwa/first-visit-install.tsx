"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Download, Smartphone, Sparkles, X } from "lucide-react";
import type { PresenceInstallPrompt } from "@/components/pwa-register";

const DISMISS_KEY = "presence:install-prompt-dismissed-at";
const RESHOW_MS = 7 * 24 * 60 * 60 * 1_000;

export function FirstVisitInstall({ persistent = false }: { persistent?: boolean }) {
  const [visible, setVisible] = useState(false);
  const [prompt, setPrompt] = useState<PresenceInstallPrompt | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setStandalone(standalone);
      const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY)) || 0;
      if (persistent || (!standalone && Date.now() - dismissedAt > RESHOW_MS)) setVisible(true);
      setIos(/iPad|iPhone|iPod/i.test(navigator.userAgent));
      setPrompt(window.__presenceInstallPrompt ?? null);
    }, 0);
    const ready = () => { setPrompt(window.__presenceInstallPrompt ?? null); setVisible(true); };
    window.addEventListener("presence:install-ready", ready);
    return () => { window.clearTimeout(initialize); window.removeEventListener("presence:install-ready", ready); };
  }, [persistent]);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    const available = prompt ?? window.__presenceInstallPrompt;
    if (!available) return;
    await available.prompt();
    const choice = await available.userChoice;
    if (choice.outcome === "accepted") dismiss();
  }

  if (!visible) return null;
  return <aside className="first-install-card">
    {!persistent && <button className="icon-button install-dismiss" onClick={dismiss} aria-label="Dismiss install suggestion"><X size={17} /></button>}
    <span className="install-app-icon"><Image src="/icons/presence-192-v2.png" alt="" width={60} height={60} /></span>
    <div><span className="install-kicker"><Sparkles size={13} /> BEST EXPERIENCE</span><strong>{standalone ? "Presence is installed" : "Keep Presence one tap away"}</strong><small>{standalone ? "You are using the secure installed app with faster access to attendance and reminders." : ios ? "In Safari, tap Share and choose Add to Home Screen. Then enable notifications for attendance reminders." : "Install the secure app for faster attendance and reminders even when your browser is closed."}</small></div>
    {!standalone && prompt && <button className="button button-primary" onClick={install}><Download size={17} /> Install Presence</button>}
    {!standalone && !prompt && <span className="install-device-hint"><Smartphone size={18} /> {ios ? "Use Safari Share" : "Use your browser's Install app menu"}</span>}
  </aside>;
}
