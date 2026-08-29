# JobCardScanner - Android App (Expo / React Native / TypeScript)

The staff-facing Android app: workshop staff sign in with Azure AD and get a phone-sized
subset of the web app - dashboard KPIs, job card list/detail (stage advance, work timer,
quality check), and the parts catalog. The customer tracking portal is web-only (it's a
link/QR code customers open in any browser, not an app they install).

## Prerequisites

- Node.js 18+
- The [Expo Go](https://expo.dev/go) app on your Android phone, **or** Android Studio with
  an emulator, for local testing.
- The JobCardScanner backend running and reachable from your phone/emulator (see
  `../backend/README.md`).
- An Azure AD App Registration - see `../docs/AZURE_AD_SETUP.md` (Part 2 covers adding the
  "Mobile and desktop applications" redirect URI this app needs).

## Setup

```bash
cd mobile
npm install
cp .env.example .env
# edit .env with your Azure AD client/tenant IDs and your reachable API URL
npx expo start
```

Scan the QR code with Expo Go (Android), or press `a` to launch an Android emulator.

### Azure AD redirect URI

This app requests the redirect URI `jobcardscanner://auth` (the custom `scheme` set in
`app.json`). Add that exact URI to your Client App Registration's "Mobile and desktop
applications" platform in the Azure Portal (see `../docs/AZURE_AD_SETUP.md` Part 2).

If you're testing inside **Expo Go** rather than a standalone/dev-client build, Expo may
route the redirect through its own proxy (`https://auth.expo.io/@your-expo-username/jobcardscanner`)
instead of the custom scheme - if sign-in fails with a redirect URI mismatch, check the
exact URI `expo-auth-session` logs to the console and add that one too.

### Reaching the backend from your phone/emulator

- **Android Studio emulator**: use `http://10.0.2.2:5000` (the emulator's alias for your
  computer's `localhost`) - this is the `.env.example` default.
- **Expo Go on a physical phone**: use your computer's LAN IP, e.g. `http://192.168.1.50:5000`,
  and make sure your phone is on the same Wi-Fi network as your computer. Your backend must
  also be listening on `0.0.0.0`, not just `localhost` (see `../backend/README.md`).

## What's implemented

- Azure AD sign-in via `expo-auth-session` (Authorization Code + PKCE, no client secret -
  see `src/auth/AuthContext.tsx`), with tokens persisted in `expo-secure-store` and silently
  refreshed on launch.
- Dashboard KPIs (`src/screens/DashboardScreen.tsx`).
- Job card list with search (`src/screens/JobCardsListScreen.tsx`).
- Job card detail: stage advance, complaints, technician work timer (start/stop), and a
  quick quality-check pass action (`src/screens/JobCardDetailScreen.tsx`).
- Parts catalog search (`src/screens/PartsScreen.tsx`).

The web app (`../web`) remains the full-featured surface (the Job Card Opening Wizard,
estimates/additional-work approval sending, invoicing, admin screens, reports/export, and
the customer tracking portal) - this app is scoped to the on-the-floor staff actions that
benefit most from being on a phone. Extending it to any other screen just means adding a
new screen under `src/screens` and wiring it into `src/navigation/RootNavigator.tsx`; every
screen talks to the same backend through `src/api/client.ts`.

## Building a real Android APK/AAB

This project uses Expo's managed workflow, so a real device build goes through
[EAS Build](https://docs.expo.dev/build/introduction/) once you're ready to distribute
beyond Expo Go:

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform android
```

You'll need a free (or paid) Expo account for EAS Build; this repository does not include
any Expo/EAS account configuration since that's tied to whoever owns the app.
