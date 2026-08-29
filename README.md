# JobCardScanner

A full rebuild of the EV two-wheeler workshop job card management system on: **React +
TypeScript** (web), **ASP.NET Core 8 Web API** (backend, C#), a **SQL Server database named
`JobCardScanner`** (EF Core Code-First), **Azure AD (Microsoft Entra ID)** authentication
for staff via an App Registration, and a **React Native (Expo) Android app** alongside the
web app.

This is a second, parallel implementation of the same product covered by the earlier
Node/Express + SQLite + plain React prototype - kept as-is elsewhere and not touched by this
build. Everything in this folder is the new .NET/Azure AD/TypeScript stack, built for full
feature parity with that prototype.

## What's inside

```
backend/    ASP.NET Core 8 Web API, C#, EF Core -> SQL Server ("JobCardScanner" database)
web/        React + TypeScript + Vite - staff app (MSAL/Azure AD) + customer tracking portal
mobile/     React Native (Expo, TypeScript) - Android staff app (Azure AD via expo-auth-session)
docs/       AZURE_AD_SETUP.md - step-by-step Azure Portal instructions
```

Each folder has its own `README.md` with detailed setup instructions. The short version:

```bash
# 1. Backend
cd backend && dotnet restore
# ... configure connection string + Azure AD (see backend/README.md and docs/AZURE_AD_SETUP.md)
dotnet run --project JobCardScanner.Api

# 2. Web app
cd web && npm install
cp .env.example .env   # fill in Azure AD values
npm run dev

# 3. Android app
cd mobile && npm install
cp .env.example .env   # fill in Azure AD values
npx expo start
```

**Start with `docs/AZURE_AD_SETUP.md`** - nothing signs in until an Azure AD App
Registration exists and its IDs are in the three `.env`/`appsettings.json` files above.

## Why two implementations exist

The first prototype (Node/Express + SQLite + plain React, delivered earlier in this
conversation as `voltcare-ev-jobcard-app.zip`) satisfied the original spec end-to-end and
was fully QA-tested in this sandbox. This second build was requested afterward, specifically
asking for the React+TypeScript / ASP.NET / SQL Server / Azure AD / Android stack. Both are
legitimate, independent implementations of the same product; this one is what you asked for
most recently.

## Architecture decisions made without asking

A few calls were made in the interest of moving forward rather than blocking on questions
that already had a reasonable default - each is documented in more detail where it's
implemented:

- **Azure AD authenticates identity only; JobCardScanner's own `Users` table decides
  role/dealer.** This avoids needing to configure Azure AD App Roles or Enterprise
  Application role assignments - see `backend/JobCardScanner.Api/Auth/AppClaimsTransformation.cs`.
- **Customers are not Azure AD principals.** They sign in to the tracking portal with
  mobile + OTP through a separate, simple JWT scheme - see
  `backend/JobCardScanner.Api/Auth/CustomerTokenService.cs`.
- **The Android app covers staff on-the-floor actions** (dashboard, job card list/detail,
  stage advance, work timer, quick QC, parts catalog) rather than the full web feature set -
  the Job Card Opening Wizard, additional-work estimate creation, invoicing, Admin, and
  Reports/export stay web-only, where a larger screen suits them better. See
  `mobile/README.md` "What's implemented" for the exact list and how to extend it.
- **Entity primary keys are `Guid`** (idiomatic EF Core/C#), versus the original Node
  prototype's string nanoids.
- **No EF Core `Migrations/` folder is checked in** - see "About this build" below and
  `backend/README.md`'s last section for how to add real migrations once you've confirmed
  the project builds on your machine.

## About this build - what was and wasn't verified here

This project was built in a sandboxed environment with restricted outbound network access.
Concretely, that meant:

- **`web/` and `mobile/` (TypeScript)**: fully installable and buildable here. `npm install`
  succeeded for both (npm's registry was reachable), `npx tsc --noEmit` passes cleanly for
  both projects, and `npm run build` (web) completes a full production Vite build with no
  errors. These were genuinely compiled and checked, not just written and assumed correct.
- **`backend/` (C#/.NET)**: **could not be compiled or run here** - this sandbox's network
  proxy allowlist does not include `api.nuget.org`, so `dotnet restore` fails immediately
  (confirmed, not assumed) and nothing that depends on it - `dotnet build`, `dotnet ef
  migrations add`, running the API - could be executed. Every `.cs` file was instead written
  carefully by hand against the exact pinned package versions and reviewed line by line
  (namespace resolution, DbContext/DbSet names matching every usage, EF Core relationship
  configuration, the dual-auth scheme wiring, controller route/policy correctness) - this
  review caught and fixed several real bugs before delivery (a namespace-resolution bug in
  `Program.cs` calling the seeder, an authentication-scheme detection bug in the Azure AD
  claims transformation that would have silently broken all staff sign-ins, and a premature
  auto-close bug in the quality-check endpoint). Even so, **you should run `dotnet restore
  && dotnet build` yourself as the very first step** - that is the one check this
  environment genuinely could not perform.

Please run `dotnet build` right after unzipping and treat any errors it surfaces as
legitimate bug reports against this delivery, not configuration problems on your end.

## Demo data

`backend/JobCardScanner.Api/Data/DbSeeder.cs` seeds 2 dealers, staff across all 8 roles, 6
customers with vehicles/warranties, a 10-item spare-parts catalog, and the default 15-stage
workflow template automatically on first run (Development only). Staff sign in via Azure AD
- there's no password to seed - so before your first sign-in, either add your own email to
`DbSeeder.cs` with the `SystemAdmin` role, or add yourself through **Admin > Users** once
someone with `SystemAdmin`/`DealerAdmin` access has signed in (see
`docs/AZURE_AD_SETUP.md` Part 4 for why this step exists).
