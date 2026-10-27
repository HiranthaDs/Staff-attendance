# Presence

Presence is a production-oriented office attendance and leave PWA built with Next.js, React, Node.js, Supabase and OpenStreetMap. The frontend and secure server API deploy together as one Vercel project.

## What is included

- Supabase email/password authentication with persistent cookie sessions
- Super-admin-only management authorization; legacy branch-admin accounts use the same employee portal and permissions as staff
- Map-based branch creation and real OpenStreetMap branch cards with configurable 50–1,000 m geofences
- Click-through branch details with branch-scoped staff creation
- Secure, expiring, one-time branch-detail links for remote office setup
- One-tap branch capture for GPS, accuracy, public IP, network quality and device details
- Super-admin review and approval before a submitted office becomes an active branch
- Required `location + office public IP`, flexible `location or IP`, and `location only` verification modes
- Short-lived, single-use attendance challenges bound to the employee, action, branch and observed IP
- Raw multi-sample GPS evidence recomputed by server-only Node.js code on both clock-in and clock-out
- Confidence-aware geofencing that can safely use a coarse reading only when its full uncertainty circle fits inside the office zone
- Explicit attendance confirmation before any location or attendance request starts
- IPv4, IPv6 and CIDR office-network rules
- Same-origin, authenticated Next.js Route Handlers with no separately exposed backend
- Atomic, idempotent attendance writes and a full allowed/denied attempt audit trail
- One record per employee per branch-local day, including safe after-midnight clock-out
- One employee per non-office IP and day; approved office NAT addresses remain shareable
- Branch-level late-arrival and early-departure grace periods, timing flags and work-duration calculation
- Staff creation with a temporary password and forced first-login password reset
- Monthly and annual leave allowances, employee requests and admin approvals
- Staff calendar with gazetted Sri Lankan public holidays, Poya days and super-admin notes for all or selected branches
- Live in-app/browser alerts when an administrator changes the shared calendar
- Full employee profile pages, year-to-date hour totals and admin employee calendars with leave, short-leave and timing colors
- Responsive employee and admin experiences
- Installable PWA shell with offline-safe behavior (attendance is intentionally never queued offline)
- Database RLS, server-only secret-key use and protected administrator APIs

## Security model

Attendance approval happens only in server-side Node.js code inside authenticated Next.js Route Handlers. The server reads the public IP only from an explicitly trusted platform/proxy path, reloads the employee, branch and active network rules from Supabase, recomputes GPS consensus, freshness, spread and distance from raw readings, and calls service-only PostgreSQL functions. Browser clients cannot call those functions or choose their own branch policy. PostgreSQL independently rechecks challenge binding, GPS distance, account and branch state, replay status, network matching, idempotency and daily uniqueness inside one transaction.

The recommended production mode is **location + office public IP required**. Give each branch a static public IP from its internet provider. A dynamic IP can change unexpectedly and block legitimate staff until the admin updates the rule. The configured radius is the valid area—an employee does not need to stand on the exact map pin. A precise consensus point inside the radius passes; a coarser reading passes only when its whole uncertainty circle fits inside the radius.

An office public IP is shared by employees behind the same router, so it cannot safely be globally limited to one employee. Presence instead keeps the database guarantee of one attendance record per employee/day and prevents an unapproved, non-office IP from being claimed by two employees at the same branch/day.

No browser-only system can make location spoofing mathematically impossible. A PWA cannot access Wi-Fi SSIDs or provide hardware device attestation. Combining precise GPS, a trusted server-observed public IP, short-lived samples, audit logs and HTTPS is the strongest reliable browser approach. For higher-assurance environments, add a native mobile app with device attestation or managed-device certificates.

## Local development

1. Install the Node.js dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the Supabase values.

3. Apply the database migration:

   ```bash
   npm run db:migrate
   ```

4. Create or repair the initial super-admin account:

   ```bash
   npm run db:bootstrap-admin
   ```

5. Start the complete application:

   ```bash
   npm run dev
   ```

The base schema and every additive migration are in [`supabase/migrations`](supabase/migrations). Apply all migrations in filename order; they create branch setup, short-lived attendance challenges, atomic v2 attendance functions, calendar notes and the current least-privilege policies.

If attendance displays **“Attendance database setup is incomplete”**, the deployed database does not have the v2 challenge/RPC migration. Run `npm run db:migrate`, enter the Supabase database password, and restart or redeploy the app. The migrator is additive and applies every SQL file in filename order.

## Deploy to Vercel

Import this repository into Vercel as a Next.js project. No separate backend, Docker service, custom build command or output directory is required. Add these variables to Production, Preview and Development:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_APP_URL=https://your-production-domain.example
```

Keep `SUPABASE_SECRET_KEY` server-only; never prefix it with `NEXT_PUBLIC_`. Apply every SQL file in `supabase/migrations` before the first deployment. In Supabase Auth settings, use the production origin as the Site URL and add:

```text
https://your-production-domain.example/auth/callback
```

Vercel supplies the trusted client-IP header used by the attendance verifier. HTTPS is required for browser geolocation and PWA installation outside localhost. After changing environment variables, redeploy so both the build and server functions receive the new values.

## First run

1. Sign in as the super admin.
2. Create a branch, select its exact map position, and choose a radius.
   Alternatively, open **Settings → Branch setup**, generate a secure link and send it to the branch manager. Their captured details remain pending until the super admin approves them.
3. While physically connected to the office Wi-Fi, use **Use my current IP**.
4. Confirm the branch internet connection has a static public IP.
5. Save each branch's allowed late-arrival and early-departure tolerance, create staff accounts, assign work hours and leave allowances, then share temporary credentials securely.
6. Test clock-in and clock-out from a real mobile phone before rollout.

## Verification commands

```bash
npm run typecheck
npm run lint
npm run build
npm run verify:location
npm run verify:ip
npm run verify:verifier
npm run verify:attendance-route
npm run verify:live
```

`verify:security` runs the client GPS, trusted proxy/IP and server-side Node.js verifier suites together. `verify:attendance-route` runs disposable login, challenge, GPS consensus, clock-in, idempotent retry, clock-out and Supabase transaction checks, then removes its test data. `verify:live` checks authentication, the live super-admin profile, anonymous read denial and attendance-RPC permissions.

`verify:branch-setup` runs the complete link-generation, public submission, approval and office-network workflow, then removes its disposable test records.

### Wi-Fi name limitation

Web browsers do not expose the connected Wi-Fi SSID or BSSID. Presence automatically fills a read-only public IP, rechecks it immediately before submission, collects supported network-quality and device fields, and asks the branch manager to copy only the Wi-Fi name from device settings. In production, the public IP must come from the configured trusted cloud proxy. During localhost office testing, at least two independent public-IP services must agree on the local server's internet egress address. The SSID is manager-entered; the public IP is server-verified. Never treat a browser-provided network label as proof of Wi-Fi—the strict mode uses the trusted public IP together with GPS.

## Credential hygiene

`.env.local` is ignored by Git. Rotate any secret key or database password that has been shared through chat, email or screenshots, then update the local and cloud environment variables. Staff temporary passwords should also be delivered through a secure channel.
