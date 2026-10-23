Android list screens - search, sort chips and 10-per-page paging (23.10.2026). Copy over your mobile project (paths relative to mobile\), then npx expo start -c. No new packages, no native rebuild.

  src\components\MasterCrud.tsx              CHANGED   -> Service Menu Master, Complaint Master and Prefix Master all get it
  src\components\ListControls.tsx            CHANGED   (supersedes the Menu Access copy; SearchBox gets an optional onSubmit)
  src\lib\listView.ts                        same as the Menu Access update
  src\screens\TechnicianEmployeesScreen.tsx  CHANGED
  src\screens\StaffUsersScreens.tsx          CHANGED   (Dealer Employees + Admin: Users)
  src\screens\LedgerMasterScreen.tsx         CHANGED
  src\screens\LabourMasterScreen.tsx         CHANGED   (+ a crash fix, below)

Each list: a search box (matches every field), sort chips (tap = ascending, again = descending), a count line, and a pager (Prev / Next, 10 / 25 / 50 per page).
- Ledger Master: now page by page from the server (10 per page, with the total) instead of "load 50 more as you scroll"; the sort chips order the page on screen; search and Ledger Type are still done by the server.
- Labour Master: the long Search button is now a compact button next to the search box; sort chips (Code / Model / Rate / Status); 10 per page.
- Employees / Admin: Users / Technician: status badge, the filters stay (Work Area location, Role, Show inactive).
FIXED (found while reading Labour Master): after a successful Excel import the screen drew a web-only <p> tag, which React Native cannot render and which would have crashed the screen. It is now a normal green message.
The rest of the app was scanned for other web-only tags: none.

Checked: tsc 0 errors, Expo Android bundle builds, the list logic passed its tests (same code, in a test harness).
NOT checked: the screens on a phone or emulator.
NOT done: Admin: Workflow (about a dozen rows, left as is) and the screens that were not in your paste - tell me which come next.
