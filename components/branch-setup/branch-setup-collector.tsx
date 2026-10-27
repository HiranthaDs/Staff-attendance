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
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { MapPicker } from "@/components/admin/map-picker";
import { captureBestBrowserLocation, type CapturedBrowserLocation } from "@/lib/browser-location";
import { distanceInMeters } from "@/lib/geofence";

type Invite = {
  proposed_name: string;
  proposed_code: string;
  radius_m: number;
  verification_mode: "gps_only";
  status: string;
  expires_at: string;
};

type OfficePin = {
  latitude: number;
  longitude: number;
};

export function BranchSetupCollector({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
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
        if (json.invite.status === "submitted" || json.invite.status === "approved") setSubmitted(true);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This setup link is unavailable."))
      .finally(() => setLoading(false));
  }, [token]);

  async function captureOffice() {
    setError("");
    if (!navigator.onLine) return setError("Connect to the internet and try again.");
    if (!navigator.geolocation) return setError("This browser does not support location capture.");
    setCapturing(true);
    setCaptureHint("Getting a fresh location reading...");

    try {
      const best = await captureBestBrowserLocation({
        maximumAccuracyM: 200,
        minimumConsensusSamples: 1,
        minimumSampleSpanMs: 0,
        minimumWaitMs: 1_000,
        maximumWaitMs: 15_000,
        onProgress: ({ bestAccuracyM }) => {
          setCaptureHint(`Location found with +/-${Math.round(bestAccuracyM)} m accuracy.`);
        },
      });
      setLocation(best);
      setOfficePin({ latitude: best.latitude, longitude: best.longitude });
      setCaptureHint(`Location captured with +/-${Math.round(best.accuracy)} m accuracy.`);
      const geocodeRequestId = ++geocodeRequestRef.current;
      const addressResponse = await fetch(`/api/branch-setup/reverse-geocode?lat=${best.latitude}&lng=${best.longitude}`)
        .then((response) => response.ok ? response.json() : { address: "" })
        .catch(() => ({ address: "" }));
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
      setCaptureHint("Rechecking the office location before submission...");
      const evidence = await captureBestBrowserLocation({
        maximumAccuracyM: 200,
        minimumConsensusSamples: 1,
        minimumSampleSpanMs: 0,
        minimumWaitMs: 1_000,
        maximumWaitMs: 15_000,
        onProgress: ({ bestAccuracyM }) => setCaptureHint(`Final location accuracy: +/-${Math.round(bestAccuracyM)} m.`),
      });
      setLocation(evidence);

      const evidenceToPinM = distanceInMeters(evidence, officePin);
      if (evidenceToPinM > Math.min(150, evidence.accuracy + 25)) {
        throw new Error("The selected office pin does not match your current location. Return to the office or correct the map pin.");
      }

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
          manager_name: form.get("manager_name"),
          manager_phone: form.get("manager_phone"),
          notes: form.get("notes") || null,
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
          <p>Stand inside the office and capture its location from this device. No Wi-Fi name or IP address is needed.</p>
          <div className="setup-meta"><span><Building2 size={15} /> {invite.proposed_code}</span><span><MapPin size={15} /> {invite.radius_m} m attendance zone</span><span><ShieldCheck size={15} /> Expires {new Date(invite.expires_at).toLocaleString()}</span></div>
        </section>

        <section className="capture-card">
          <div className="capture-card-copy"><span className="capture-number">1</span><div><h2>Capture office details</h2><p>Allow precise location while standing inside the office.</p></div></div>
          <button className="capture-button" onClick={captureOffice} disabled={capturing || saving}>{capturing ? <LoaderCircle className="spin" size={24} /> : <Crosshair size={24} />}<span><strong>{capturing ? "Getting location…" : location ? "Capture again" : "Capture location"}</strong><small>Current location only</small></span></button>
          {captureHint && <div className="capture-hint"><ShieldCheck size={17} /> {captureHint}</div>}
          {error && <div className="form-alert error"><CircleAlert size={17} /> {error}</div>}
        </section>

        {location && officePin && <form onSubmit={submit} className="setup-detail-grid">
          <section className="setup-map-card">
            <div className="setup-section-title"><span className="capture-number">2</span><div><h2>Confirm the exact office pin</h2><p>Drag the pin only if GPS placed it on a nearby building.</p></div></div>
            <MapPicker latitude={officePin.latitude} longitude={officePin.longitude} radius={invite.radius_m} onChange={updateOfficePin} />
            <div className="setup-detected-grid"><DetectedItem icon={<MapPin />} label="Location accuracy" value={`±${Math.round(location.accuracy)} metres`} good={location.accuracy <= 100} /><DetectedItem icon={<Smartphone />} label="Device" value={deviceLabel()} /></div>
          </section>
          <section className="setup-form-card">
            <div className="setup-section-title"><span className="capture-number">3</span><div><h2>Confirm branch information</h2><p>A super admin will review this before creating the branch.</p></div></div>
            <div className="stack-lg">
              <label className="field"><span>Full office address</span><textarea required maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Building, street, city and postal code" /></label>
              <div className="form-grid"><label className="field"><span>Your name</span><input name="manager_name" required placeholder="Branch manager name" /></label><label className="field"><span>Phone number</span><input name="manager_phone" required placeholder="+94 77 123 4567" /></label></div>
              <label className="field"><span>Notes (optional)</span><textarea name="notes" maxLength={500} placeholder="Floor, entrance or anything the admin should know" /></label>
              <label className="setup-confirm"><input type="checkbox" required /><span>I checked the map and confirm the pin is on the exact office building.</span></label>
              <label className="setup-confirm"><input type="checkbox" required /><span>I am physically inside the office and have allowed precise location.</span></label>
              <button className="button button-primary button-lg button-full" disabled={saving || capturing}>{saving ? <><LoaderCircle className="spin" size={18} /> Saving securely…</> : <>Submit branch details <Check size={18} /></>}</button>
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

function deviceLabel() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return mobile ? "Mobile device" : "Computer";
}
