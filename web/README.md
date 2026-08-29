# JobCardScanner - Web App (React + TypeScript + Vite)

The full-featured surface of JobCardScanner: staff sign in with Azure AD (MSAL) and get the
complete workflow - dashboard, job card wizard, job card detail (stage engine, complaints,
technician work log, QC, additional-work estimates, parts, invoicing, OTP closure), Admin
(users, workflow config), and Reports/global search with Excel export. It also hosts the
customer-facing tracking portal (mobile+OTP sign-in, real-time status timeline, additional
work approval, invoice download) at `/portal/*` and `/track/:token`.

## Setup

```bash
cd web
npm install
cp .env.example .env
# edit .env with your Azure AD client/tenant IDs and your running backend's URL
npm run dev
```

Open `http://localhost:5173`. Staff sign in at `/login`; the customer portal is at
`/portal/login` (or a direct `/track/<token>` link, as sent by SMS after a job card is
created).

See `../docs/AZURE_AD_SETUP.md` for how to obtain the Azure AD values `.env` needs (Part 2
covers adding `http://localhost:5173` as this app's redirect URI).

## Project layout

```
src/
  auth/          MSAL config + StaffAuthContext (resolves /api/auth/me), CustomerAuthContext
  api/           axios clients: staffApi (attaches Azure AD token), portalApi (customer JWT)
  components/    StaffLayout (role-aware nav), RequireStaff guard, StatusBadge
  pages/staff/   Dashboard, Job Cards list/wizard/detail, Parts, Reports, Admin
  pages/portal/  Customer login, my job cards, public tracking page
  types/         TypeScript types mirroring the backend's C# models/enums
```

## Verified

`npm run build` (`tsc -b && vite build`) completes cleanly - see the root README for what
that does and doesn't prove.
