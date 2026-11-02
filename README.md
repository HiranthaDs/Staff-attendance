# Presence

Presence is an office attendance and leave PWA built with Next.js, React, Supabase, and OpenStreetMap. The frontend and server-side attendance API deploy together as one Vercel project.

## Attendance rule

Attendance is location-only. On clock-in and clock-out, the app collects three fresh high-accuracy browser readings over at least two seconds. The server builds a stable consensus, reloads the employee and branch from Supabase, recomputes the distance, and accepts the mark when:

- the location is fresh and valid;
- reported accuracy is within the supported limit; and
- the measured point is inside the branch's configured radius.

The employee does not need to stand on the exact office pin. IP addresses, Wi-Fi names, SSIDs, and browser network information are not collected or used for attendance.

Browser geolocation requires HTTPS outside localhost. Staff should enable precise location for the installed PWA or browser. As with every browser-based location system, a modified device can spoof coordinates; higher-assurance environments require a native app with device attestation.

## Included features

- Supabase email/password authentication and cookie sessions
- Dedicated super-admin portal with role isolation, database-backed attempt limits, hashed security auditing, and last-login telemetry
- One registered browser per attendance-capable staff account, with server-enforced checks, super-admin one-time replacement codes, and an auditable reset history
- SaaS hierarchy with platform super admins, isolated companies, company owners, branch admins, and staff
- Platform company provisioning, suspension controls, plans, and database-enforced active-user limits
- Hashed, expiring, one-time registration links for company owners and staff (passwords are never sent by email)
- Personalized company login URLs that remain separate from one-time account-activation links
- Company-owner branch, employee, payroll, leave, and calendar management
- Map-based branch setup with configurable 50-1,000 metre radii
- Backward-compatible direct branch creation for databases awaiting the newest migration
- Secure one-time links for remote branch-location capture
- Server-side distance verification for clock-in and clock-out
- Short-lived, single-use attendance challenges and audit records
- Attendance-aware staff sign-out that closes an open shift as a clearly flagged, unverified logout departure
- Idempotent daily attendance records and safe clock-out handling
- Branch-level late-arrival and early-departure grace periods
- Monthly and annual leave requests and approvals
- Super-admin per-employee weekly schedule editor, with 9:00–17:00 full days and 9:00–14:00 half days by default
- Complete employee lifecycle profiles covering probation/permanent/contract status, employment dates, department, identity, address, emergency contact, leave and schedule details
- Gazette-backed 2026/2027 Sri Lankan holidays plus staff suggestions and super-admin approval
- Employee and admin calendars with secure month-by-month attendance history, approved leave, holidays, weekly off-days, and timing colours
- Durable notification inbox plus background Web Push for leave, calendar, start-time, and finish-time alerts
- Branded owner/staff invitation emails and administrator-issued password-reset emails
- Branch/month-named CSV ledgers with scheduled, absent, leave, holiday, off-day, and attendance rows
- Persistent, refresh-token-rotated sessions that remain signed in until explicit logout or a real authentication failure
- Employee profile pages and year-to-date hour totals
- Salary creation workspace with a company-wide configurable cycle start date, employee attendance ledger, deductions, EPF/ETF, and CSV export
- Midnight missed-attendance recording with a highlighted next-login notice and zero worked hours
- Staff issue reporting, administrator resolution, and an office map that shows both the office zone and the employee's live location
- Installable responsive PWA with update detection, navigation preload, offline fallback, shortcuts and safe static caching; attendance is never queued offline
- Search-safe technical SEO/AEO with structured product/FAQ data and explicit blocking of private portal routes
- Supabase row-level security and server-only privileged access

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and enter the Supabase values.

3. Apply all database migrations:

   ```bash
   npm run db:migrate
   ```

4. Create or repair the initial super-admin account:

   ```bash
   npm run db:bootstrap-admin
   ```

5. Start the application:

   ```bash
   npm run dev
   ```

Migrations are in `supabase/migrations` and must be applied in filename order. The SaaS migrations add organization keys, tenant-aware row-level security, company-owner invitations, per-company uniqueness and indexed capacity controls. The database serializes concurrent account activations before enforcing each company's active-user limit, so simultaneous invitation acceptance cannot overfill a plan.

## Deploy to Vercel

Import this repository into Vercel as a Next.js project. No separate backend, Docker service, custom build command, or output directory is needed. Configure these variables for Production, Preview, and Development:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_APP_URL=https://your-production-domain.example
RESEND_API_KEY
EMAIL_FROM=Presence <attendance@your-domain.example>
NEXT_PUBLIC_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:admin@your-domain.example
CRON_SECRET
```

Generate Web Push keys with `npx web-push generate-vapid-keys`. `vercel.json` runs the attendance reminder endpoint every ten minutes; Vercel sends `CRON_SECRET` to protect that endpoint. Welcome/password-reset email uses Resend and remains safely copyable from the administrator receipt if email delivery is not configured.

Keep `SUPABASE_SECRET_KEY` server-only. Apply every migration before deploying. In Supabase Auth settings, set the production Site URL and add:

```text
https://your-production-domain.example/auth/callback
```

HTTPS from Vercel enables browser geolocation and PWA installation. After changing environment variables, redeploy the project.

## First run

1. Sign in as the platform super admin at `/super-admin/login` and create a company workspace.
2. Send the generated owner-registration link; the company owner chooses their password and signs in.
3. The company owner creates branches and sends one-time registration links to staff or branch administrators.
4. Configure attendance tolerances, employee work hours, leave allowances, and payroll settings.
5. Test clock-in and clock-out on a real phone with precise location enabled.

## Verification commands

```bash
npm run typecheck
npm run lint
npm run build
npm run verify:security
npm run verify:workday
npm run verify:direct-branch
npm run verify:attendance-route
npm run verify:live
```

`verify:security` checks browser location handling and the server attendance verifier. `verify:direct-branch` confirms direct branch creation against the connected database (including the compatibility path) and removes its disposable branch. `verify:attendance-route` runs disposable login, challenge, location, clock-in, retry, clock-out, and database checks, then removes its test data.

## Credential hygiene

`.env.local` is ignored by Git. Rotate any secret or database password exposed through chat, email, or screenshots, and update both local and Vercel environment variables. Temporary passwords are always forced to change at the next sign-in; protect the staff mailbox and do not forward credential messages.
