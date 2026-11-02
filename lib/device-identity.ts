"use client";

export type LoginDeviceCredential = {
  id: string;
  secret: string;
  label: string;
};

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function deviceLabel() {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? "Edge"
    : /CriOS|Chrome\//.test(agent) ? "Chrome"
      : /Firefox\//.test(agent) ? "Firefox"
        : /Safari\//.test(agent) ? "Safari"
          : "Web browser";
  const platform = /Android/i.test(agent) ? "Android"
    : /iPad|iPhone|iPod/i.test(agent) ? "iPhone or iPad"
      : /Windows/i.test(agent) ? "Windows"
        : /Macintosh|Mac OS X/i.test(agent) ? "macOS"
          : /Linux/i.test(agent) ? "Linux"
            : "this device";
  return `${browser} on ${platform}`.slice(0, 120);
}

export function getOrCreateLoginDevice(): LoginDeviceCredential {
  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  return { id: crypto.randomUUID(), secret: base64Url(secret), label: deviceLabel() };
}
