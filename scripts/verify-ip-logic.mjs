import assert from "node:assert/strict";
import {
  getRequestIp,
  ipMatchesRule,
  networkRuleForIp,
  normalizeIp,
  resolveRequestIp,
} from "../lib/attendance.ts";

const original = {
  VERCEL: process.env.VERCEL,
  TRUSTED_PROXY_PROVIDER: process.env.TRUSTED_PROXY_PROVIDER,
  TRUST_PROXY_HEADERS: process.env.TRUST_PROXY_HEADERS,
  TRUSTED_PROXY_HOPS: process.env.TRUSTED_PROXY_HOPS,
};

try {
  delete process.env.VERCEL;
  delete process.env.TRUSTED_PROXY_PROVIDER;
  delete process.env.TRUST_PROXY_HEADERS;
  delete process.env.TRUSTED_PROXY_HOPS;

  assert.equal(normalizeIp("203.0.113.10:443"), "203.0.113.10");
  assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8:0:0:0:0:0:1");
  assert.equal(normalizeIp("::ffff:192.0.2.4"), "192.0.2.4");
  assert.equal(networkRuleForIp("2001:db8::1234"), "2001:db8:0:0:0:0:0:1234");
  assert.equal(ipMatchesRule("203.0.113.18", "203.0.113.0/24"), true);
  assert.equal(ipMatchesRule("203.0.114.18", "203.0.113.0/24"), false);

  const spoofed = new Headers({ "x-forwarded-for": "8.8.8.8" });
  assert.equal(getRequestIp(spoofed), null);
  assert.equal((await resolveRequestIp(spoofed)).verified, false);

  process.env.VERCEL = "1";
  const vercel = new Headers({ "x-vercel-forwarded-for": "8.8.4.4" });
  assert.equal(getRequestIp(vercel), "8.8.4.4");
  assert.equal((await resolveRequestIp(vercel)).source, "vercel_client");
  delete process.env.VERCEL;

  process.env.TRUST_PROXY_HEADERS = "true";
  process.env.TRUSTED_PROXY_HOPS = "2";
  const proxy = new Headers({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" });
  assert.equal(getRequestIp(proxy), "1.1.1.1");
  assert.equal((await resolveRequestIp(proxy)).source, "trusted_proxy");
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("IP trust and network rule checks passed.");
