"use client";

import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  CircleAlert,
  Crosshair,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Router,
  ShieldCheck,
  Smartphone,
  Wifi,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { MapPicker } from "@/components/admin/map-picker";
import { captureBestBrowserLocation, type CapturedBrowserLocation } from "@/lib/browser-location";
import { distanceInMeters } from "@/lib/geofence";

type Invite = {
  proposed_name: string;
  proposed_code: string;
  radius_m: number;
  verification_mode: "gps_and_ip" | "gps_or_ip" | "gps_only";
  status: string;
  expires_at: string;
};

type NetworkInfo = {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

type OfficePin = {
  latitude: number;
  longitude: number;
};

export function BranchSetupCollector({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [publicIpSource, setPublicIpSource] = useState("");
  const [location, setLocation] = useState<CapturedBrowserLocation | null>(null);
  const [officePin, setOfficePin] = useState<OfficePin | null>(null);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [captureHint, setCaptureHint] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const geocodeRequestRef = useRef(0);

  useEffect(() => {
    fetch(`/api/branch-setup/${token}`)
      .then(async (response) => ({ ok: response.ok, json: await response.json() }))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json.error);
        setInvite(json.invite);
        setPublicIp(json.public_ip);
        setPublicIpSource(json.public_ip_source || "");
        if (json.invite.status === "submitted" || json.invite.status === "approved") setSubmitted(true);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This setup link is unavailable."))
      .finally(() => setLoading(false));
  }, [token]);

  async function captureOffice() {
    setError("");
    if (!navigator.onLine) return setError("Connect to the office internet and try again.");
    if (!navigator.geolocation) return setError("This browser does not support location capture.");
    setCapturing(true);
    setCaptureHint("Keep the phone still while several fresh readings are compared...");

    try {
      const best = await captureBestBrowserLocation({
        desiredAccuracyM: 35,
        maximumAccuracyM: 150,
        minimumWaitMs: 6_000,
        maximumWaitMs: 30_000,
        onProgress: ({ bestAccuracyM, sampleCount, consensusCount }) => {
          setCaptureHint(`Checking location... +/-${Math.round(bestAccuracyM)} m, ${consensusCount}/${sampleCount} readings agree.`);
        },
      });
      setLocation(best);
      setOfficePin({ latitude: best.latitude, longitude: best.longitude });
      setCaptureHint(`${best.consensusCount}/${best.sampleCount} readings agree within ${best.spreadM} m: +/-${Math.round(best.accuracy)} m accuracy.`);
      const geocodeRequestId = ++geocodeRequestRef.current;
      const [networkResponse, addressResponse] = await Promise.all([
        fetch(`/api/branch-setup/${token}`).then(async (response) => {
          const json = await response.json();
          if (!response.ok) throw new Error(json.error || "The office public IP could not be checked.");
          return json;
        }),
        fetch(`/api/branch-setup/reverse-geocode?lat=${best.latitude}&lng=${best.longitude}`)
          .then((response) => response.ok ? response.json() : { address: "" })
          .catch(() => ({ address: "" })),
      ]);
      if (!networkResponse.public_ip || !networkResponse.public_ip_verified) {
        throw new Error("The public IP could not be verified. Connect only to office Wi-Fi, disable VPN/mobile data, and retry.");
      }
      setPublicIp(networkResponse.public_ip || null);
      setPublicIpSource(networkResponse.public_ip_source || "");
      if (geocodeRequestId === geocodeRequestRef.current && addressResponse.address) setAddress(String(addressResponse.address).slice(0, 300));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The office location could not be captured.");
      setCaptureHint("");
    } finally {
      setCapturing(false);
    }
  }

  async function updateOfficePin(latitude: number, longitude: number) {
    setOfficePin({ latitude, longitude });
    const requestId = ++geocodeRequestRef.current;
    try {
      const response = await fetch(`/api/branch-setup/reverse-geocode?lat=${latitude}&lng=${longitude}`);
      if (!response.ok) return;
      const result = await response.json();
      if (requestId === geocodeRequestRef.current && result.address) setAddress(String(result.address).slice(0, 300));
    } catch {
      // The manager can still confirm or enter the address manually.
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!location || !officePin || !invite) return setError("Capture the office location before submitting.");
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      setCaptureHint("Rechecking location consensus before secure submission...");
      const evidence = await captureBestBrowserLocation({
        desiredAccuracyM: 50,
        maximumAccuracyM: 150,
        minimumWaitMs: 5_000,
        maximumWaitMs: 25_000,
        onProgress: ({ bestAccuracyM, sampleCount, consensusCount }) => setCaptureHint(`Final check: +/-${Math.round(bestAccuracyM)} m, ${consensusCount}/${sampleCount} readings agree.`),
      });
      setLocation(evidence);

      const evidenceToPinM = distanceInMeters(evidence, officePin);
      if (evidenceToPinM > Math.min(150, evidence.accuracy + 25)) {
        throw new Error("The selected office pin does not match your current location. Return to the office or correct the map pin.");
      }

      const networkResponse = await fetch(`/api/branch-setup/${token}`);
      const networkResult = await networkResponse.json().catch(() => ({}));
      if (!networkResponse.ok || !networkResult.public_ip) {
        throw new Error(networkResult.error || "The office public IP could not be verified.");
      }
      const finalPublicIp = String(networkResult.public_ip);
      if (publicIp && finalPublicIp !== publicIp) {
        throw new Error("The internet connection changed after capture. Reconnect to the office Wi-Fi and capture again.");
      }
      setPublicIp(finalPublicIp);
      setPublicIpSource(networkResult.public_ip_source || "");

      const connection = getNetworkInformation();
      const response = await fetch(`/api/branch-setup/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          latitude: officePin.latitude,
          longitude: officePin.longitude,
          accuracy_m: Math.max(1, Math.round(evidence.accuracy)),
          captured_at: evidence.capturedAt,
          evidence_latitude: evidence.latitude,
          evidence_longitude: evidence.longitude,
          sample_count: evidence.sampleCount,
          consensus_count: evidence.consensusCount,
          spread_m: evidence.spreadM,
          expected_public_ip: finalPublicIp,
          wifi_name: form.get("wifi_name"),
          manager_name: form.get("manager_name"),
          manager_phone: form.get("manager_phone"),
          notes: form.get("notes") || null,
          connection_type: connection.type || null,
          effective_type: connection.effectiveType || null,
          downlink_mbps: connection.downlink ?? null,
          rtt_ms: connection.rtt ?? null,
          save_data: connection.saveData ?? null,
          device_info: await collectDeviceInfo({
            initialLocation: location,
            finalEvidence: evidence,
            officePin,
            evidenceToPinM,
            initialPinAdjustmentM: distanceInMeters(location, officePin),
          }),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The branch details could not be submitted.");
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The branch details could not be submitted.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="setup-public-page"><div className="setup-loading"><LoaderCircle className="spin" /><span>Opening secure setup…</span></div></main>;
  if (error && !invite) return <SetupUnavailable message={error} />;
  if (!invite) return <SetupUnavailable message="This setup link is unavailable." />;
  if (["expired", "revoked"].includes(invite.status)) return <SetupUnavailable message="This setup link has expired or was cancelled. Ask the super admin for a new link." />;
  if (submitted) return <main className="setup-public-page"><div className="setup-success-card"><span><Check size={34} /></span><p className="eyebrow">DETAILS RECEIVED</p><h1>That’s everything.</h1><p>The office details for <strong>{invite.proposed_name}</strong> are now waiting for super-admin review. This link cannot be submitted again.</p><div><ShieldCheck size={18} /> You may safely close this page.</div></div></main>;

  return (
    <main className="setup-public-page">
      <header className="setup-public-header"><Brand /><span><LockKeyhole size={14} /> Secure one-time setup</span></header>
      <div className="setup-public-container">
        <section className="setup-intro">
          <span className="eyebrow">BRANCH DETAIL COLLECTION</span>
          <h1>Set up {invite.proposed_name}</h1>
          <p>Connect to the office Wi-Fi, stand inside the office, then capture the location and internet details from this device.</p>
          <div className="setup-meta"><span><Building2 size={15} /> {invite.proposed_code}</span><span><MapPin size={15} /> {invite.radius_m} m attendance zone</span><span><ShieldCheck size={15} /> Expires {new Date(invite.expires_at).toLocaleString()}</span></div>
        </section>

        <section className="capture-card">
          <div className="capture-card-copy"><span className="capture-number">1</span><div><h2>Capture office details</h2><p>Turn off VPN and mobile data, connect to office Wi-Fi, and allow precise location.</p></div></div>
          <button className="capture-button" onClick={captureOffice} disabled={capturing || saving}>{capturing ? <LoaderCircle className="spin" size={24} /> : <Crosshair size={24} />}<span><strong>{capturing ? "Improving accuracy…" : location ? "Capture again" : "Capture automatically"}</strong><small>GPS + public IP + network + device</small></span></button>
          {captureHint && <div className="capture-hint"><ShieldCheck size={17} /> {captureHint}</div>}
          {error && <div className="form-alert error"><CircleAlert size={17} /> {error}</div>}
        </section>

        {location && officePin && <form onSubmit={submit} className="setup-detail-grid">
          <section className="setup-map-card">
            <div className="setup-section-title"><span className="capture-number">2</span><div><h2>Confirm the exact office pin</h2><p>Drag the pin only if GPS placed it on a nearby building.</p></div></div>
            <MapPicker latitude={officePin.latitude} longitude={officePin.longitude} radius={invite.radius_m} onChange={updateOfficePin} />
            <div className="setup-detected-grid"><DetectedItem icon={<MapPin />} label="GPS accuracy" value={`±${Math.round(location.accuracy)} metres (${location.consensusCount}/${location.sampleCount} agree)`} good={location.accuracy <= 50} /><DetectedItem icon={<Router />} label="Verified public IP" value={publicIp || "Unavailable"} good={Boolean(publicIp)} /><DetectedItem icon={<Wifi />} label="Connection" value={networkLabel()} /><DetectedItem icon={<Smartphone />} label="Device" value={deviceLabel()} /></div>
          </section>
          <section className="setup-form-card">
            <div className="setup-section-title"><span className="capture-number">3</span><div><h2>Confirm branch information</h2><p>A super admin will review this before creating the branch.</p></div></div>
            <div className="wifi-privacy-note"><Wifi size={19} /><div><strong>Confirm the Wi-Fi name manually</strong><span>Web browsers cannot read an SSID/Wi-Fi name. Copy it from the phone’s Wi-Fi settings so the record is accurate.</span></div></div>
            <div className="stack-lg">
              <label className="field"><span>Office public IP (automatic, read-only)</span><input value={publicIp || "Detecting..."} readOnly aria-readonly="true" /><small>{publicIpSourceLabel(publicIpSource)}</small></label>
              <label className="field"><span>Office Wi-Fi name (SSID)</span><input name="wifi_name" required minLength={2} maxLength={100} placeholder="Example: Colombo-Office-5G" /></label>
              <label className="field"><span>Full office address</span><textarea required maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Building, street, city and postal code" /></label>
              <div className="form-grid"><label className="field"><span>Your name</span><input name="manager_name" required placeholder="Branch manager name" /></label><label className="field"><span>Phone number</span><input name="manager_phone" required placeholder="+94 77 123 4567" /></label></div>
              <label className="field"><span>Notes (optional)</span><textarea name="notes" maxLength={500} placeholder="Floor, entrance, Wi-Fi router location, or anything the admin should know" /></label>
              <label className="setup-confirm"><input type="checkbox" required /><span>I checked the map and confirm the pin is on the exact office building.</span></label>
              <label className="setup-confirm"><input type="checkbox" required /><span>I am physically inside the office, connected to its normal internet, with VPN and mobile data turned off.</span></label>
              <button className="button button-primary button-lg button-full" disabled={saving || capturing || !publicIp}>{saving ? <><LoaderCircle className="spin" size={18} /> Saving securely…</> : <>Submit branch details <Check size={18} /></>}</button>
            </div>
          </section>
        </form>}
        <footer className="setup-public-footer"><ShieldCheck size={15} /> The setup link is one-time, encrypted in transit and expires automatically.</footer>
      </div>
    </main>
  );
}

function DetectedItem({ icon, label, value, good }: { icon: React.ReactNode; label: string; value: string; good?: boolean }) {
  return <div className="detected-item"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div>{good !== undefined && <i className={good ? "good" : "warn"}>{good ? "Good" : "Review"}</i>}</div>;
}

function SetupUnavailable({ message }: { message: string }) {
  return <main className="setup-public-page"><div className="setup-success-card unavailable"><span><CircleAlert size={32} /></span><p className="eyebrow">LINK UNAVAILABLE</p><h1>Setup can’t continue</h1><p>{message}</p></div></main>;
}

async function collectDeviceInfo({
  initialLocation,
  finalEvidence,
  officePin,
  evidenceToPinM,
  initialPinAdjustmentM,
}: {
  initialLocation: CapturedBrowserLocation;
  finalEvidence: CapturedBrowserLocation;
  officePin: OfficePin;
  evidenceToPinM: number;
  initialPinAdjustmentM: number;
}) {
  const extendedNavigator = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { mobile?: boolean; platform?: string; brands?: Array<{ brand: string; version: string }> };
  };
  let locationPermission = "unavailable";
  try {
    locationPermission = (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch {
    // Some otherwise capable browsers do not expose the Permissions API.
  }

  return {
    platform: extendedNavigator.userAgentData?.platform || navigator.platform,
    mobile: extendedNavigator.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
    browserBrands: extendedNavigator.userAgentData?.brands ?? null,
    language: navigator.language,
    languages: navigator.languages,
    vendor: navigator.vendor,
    maxTouchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: extendedNavigator.deviceMemory ?? null,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availableWidth: window.screen.availWidth,
      availableHeight: window.screen.availHeight,
      colorDepth: window.screen.colorDepth,
      pixelDepth: window.screen.pixelDepth,
      orientation: window.screen.orientation?.type ?? null,
      pixelRatio: window.devicePixelRatio,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    locationPermission,
    initialLocation,
    finalLocationEvidence: finalEvidence,
    officePin,
    pinAdjusted: initialPinAdjustmentM > 2,
    initialPinAdjustmentM,
    finalEvidenceToPinM: evidenceToPinM,
  };
}

function getNetworkInformation(): NetworkInfo {
  const nav = navigator as Navigator & { connection?: NetworkInfo; mozConnection?: NetworkInfo; webkitConnection?: NetworkInfo };
  return nav.connection || nav.mozConnection || nav.webkitConnection || {};
}

function networkLabel() {
  const connection = getNetworkInformation();
  return connection.type === "wifi" ? "Wi-Fi detected" : connection.effectiveType ? `${connection.effectiveType.toUpperCase()} reported` : "Browser restricted";
}

function publicIpSourceLabel(source: string) {
  if (source === "vercel_client") return "Detected from the manager’s live HTTPS request by Vercel.";
  if (source === "cloudflare_client") return "Detected from the manager’s live HTTPS request by Cloudflare.";
  if (source === "local_egress_consensus") return "Confirmed by multiple independent public-IP services from this office server.";
  if (source === "trusted_proxy") return "Detected from the configured trusted server proxy.";
  return "The value will be verified again immediately before submission.";
}

function deviceLabel() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return mobile ? "Mobile device" : "Computer";
}
