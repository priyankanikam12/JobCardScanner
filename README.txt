VAPT - web and Android (23.10.2026, final). Client side of DMS-12, DMS-14, DMS-16 and the quantity limit of DMS-08. Copy over your projects (paths relative to web\ and mobile\), then:  web: npm run build   Android: npx expo start -c
Compare first with your current copies of StaffLayout.tsx, api\client.ts (web and mobile) and JobCardDetailPage.tsx if you changed them after your last upload to me.
DEPLOY TOGETHER WITH THE API (VAPT-backend-security-23.10.2026.zip): the API now accepts a Dealer / Workshop token for at most 60 minutes, and these builds renew it silently.

WEB (web\src)
  auth\dealerRenew.ts                  NEW      swaps the token for a fresh one (POST /api/session/renew) in its last 15 minutes - one renewal at a time, quiet on failure
  api\client.ts                        CHANGED  calls the renewer before each request; sign-out already revokes the token
  pages\portal\PortalLoginPage.tsx     CHANGED  (DMS-12) no more "No account found for this mobile number." - after Send OTP it shows the API's generic sentence; a failed request says "Could not send the OTP..."
  auth\tokenStorage.ts, lib\sessionRevoke.ts, auth\dealerSession.ts, msalConfig.ts, CustomerAuthContext.tsx, main.tsx, components\StaffLayout.tsx   as in the earlier package (sessionStorage, sign-out revokes the token)
  pages\staff\JobCardDetailPage.tsx    CHANGED  video detection for signed photo addresses; quantity limit; a refused Add Suggestion shows its reason; tidier Part / Labour rows  (+ components\suggest-row.css)
ANDROID (mobile)
  src\auth\tokenRenew.ts               NEW      a copy of web's dealerRenew.ts (keep the two in step)
  src\api\client.ts                    CHANGED  renews the Dealer / Workshop token in its last 15 minutes and keeps it in SecureStore
  app.json                             CHANGED  android.allowBackup false (no Android backup of the app's data / session); usesCleartextTraffic false
  app.config.js                        NEW      the ONE way to turn cleartext (http://) back on: set ALLOW_CLEARTEXT=1 before expo / the build, for a LOCAL http API only. Never for a build that goes to staff.
  src\auth\StaffAuthContext.tsx, components\PartSuggestionSection.tsx, LabourSuggestionSection.tsx   as in the earlier package
  !! Check EXPO_PUBLIC_API_BASE_URL of the build you give to staff is https://dms.bgauss.com - with cleartext off an http:// address no longer works.

Effect for people: with sessionStorage a NEW browser tab asks for a login again (that is the point); a person who keeps working is not signed out (renewal); an hour of no activity ends the session.
Checked: web tsc 0 errors, production build OK, 26 tests in a simulated browser (renewer: 7, portal OTP page: 3, + the earlier pages); Android tsc 0 errors, Expo Android bundle OK, `expo config` shows allowBackup false / cleartext false (true only with ALLOW_CLEARTEXT=1).
NOT checked: on a device / in a real browser.
