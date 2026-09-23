============================================================
SECTION 61 - Item Master (C_ItemMaster/baplfinal) sidebar page,
             Material Transfer Bill + Repair Bill Rate/MRP/GST
             sourced from C_ItemMaster, Repair Bill Labour Code
             suggestion, Parts page Dealer Price/GST% columns
             (2026-09-21)
============================================================

YOUR REQUEST (paraphrased): a live SELECT * FROM C_ItemMaster / baplfinal paste confirming
ItemCode/ItemName/HSNCode/Dlr_Price/SGST/CGST/IGST/Status/Item_Type/DisplayName columns, asking
for (a) a new "Item Master" sidebar page reading that table via the existing BaplConnection,
(b) PartsPage.tsx to show Dealer Price/GST% too ("still ... not fetched data from baplfinal"),
(c) Material Transfer Bill's and Repair Bill's Rate/MRP/Amount/CGST/SGST/IGST to come from
C_ItemMaster instead of Part Upload's BillPrice/BalAmount ("that was dealer rate"), with an
explicit calculation rule given twice with worked numbers: Rate = Dlr_Price reverse-calculated by
GST%, then without discount Amount=MRP=Rate+GST (100+18%=118); with a discount, the discount
reduces Rate only (100-10%=90) but the GST rupee amount added back stays the ORIGINAL amount
computed on the undiscounted Rate (90+18=108=Amount), MRP staying at 118 throughout, (d) Material
Transfer's grid reordered to Item Code/Description/HSN Code/Issue Type/Qty/Rate/CGST Amt/SGST
Amt/IGST Amt/Discount Type+value/Amount/MRP, with Rack No/Bin/Valid Days/Received removed from the
grid, and (e) Repair Bill's Item Type "Labour" selector to search DMS's own Labour Master instead
of the Parts list.

FACT (confirmed by your own live SELECT * paste, 2026-09-21): C_ItemMaster in baplfinal (the SAME
BaplConnection BaplDealerService.FetchActiveDealersAsync already reads C_CustomerMaster from)
carries, per item: ItemCode, ItemName, DisplayName, HSNCode, Dlr_Price (GST-INCLUSIVE dealer
price), SGST, CGST, IGST, Item_Type, Status. This superseded an earlier, never-fully-confirmed plan
to read GST rates from BAPLDMSvad's HsnwiseTaxCodes/AggregateTaxCodes tables - that plan is
abandoned; no code for it was ever written, since implementing it would have meant guessing at
unconfirmed table/column semantics.

--------------------------------------------------------------------------------------------------
BACKEND
--------------------------------------------------------------------------------------------------

backend/JobCardScanner.Api/Services/BaplDealerService.cs (EDITED)
  - New BaplItemMasterRow record (ItemCode, ItemName, DisplayName, HsnCode, DlrPrice, Sgst, Cgst,
    Igst, ItemType, Status) - doc-commented as confirmed 2026-09-21 from your live SELECT *.
  - IBaplDealerService extended with SearchItemMasterAsync(q) and
    GetItemMasterByCodesAsync(itemCodes) (bulk lookup, capped at 2000 codes).
  - Constructor now also takes ILogger<BaplDealerService> (verified no code anywhere constructs
    this class directly - Program.cs's existing AddScoped<IBaplDealerService, BaplDealerService>()
    needs no change).
  - SearchItemMasterAsync: SELECT TOP 1000 ... FROM [dbo].[C_ItemMaster] WHERE q matches
    ItemCode/ItemName/DisplayName, ORDER BY ItemName - throws on failure (primary data source for
    the browse page).
  - GetItemMasterByCodesAsync: parameterized IN(...) lookup - BEST-EFFORT, returns an empty
    dictionary (logged, not thrown) on any failure, since it's an enrichment of an already-working
    part picker, not primary data.

backend/JobCardScanner.Api/Controllers/ItemMasterController.cs (NEW)
  - [Authorize(Policy = Policies.ServiceAdvisorUp)] (confirmed this policy exists in Program.cs and
    is used identically by BaplDmsController/MaterialTransferDocsController/RepairBillDocsController
    /CustomersController - same audience as the rest of the pricing-data surface).
  - GET /api/item-master?q=... - the Item Master page's own browse/search (502 with the real
    message on a baplfinal connection failure).
  - GET /api/item-master/by-codes?codes=A,B,C - bulk lookup for Material Transfer/Repair
    Bill/Parts to enrich whatever part list they already have loaded. Always 200 (best-effort).
  - Route confirmed not to collide with any other controller's route.

DELIBERATELY NOT TOUCHED this round: BaplDmsController.Parts, PartsController.Search,
PartUploadController.Get, MaterialTransferDocsController.Create, RepairBillDocsController.Create,
Program.cs. The C_ItemMaster enrichment is entirely CLIENT-SIDE (new /api/item-master/by-codes
endpoint + a itemMasterByCode merge in each of the three frontend pages below) - none of these
controllers' request/response DTO shapes changed, so nothing about the existing
MaterialTransferDocItem/RepairBillDocItem persisted-columns architecture changed either (see the
"WHAT IS AND ISN'T PERSISTED" note below - important).

--------------------------------------------------------------------------------------------------
FRONTEND
--------------------------------------------------------------------------------------------------

web/src/types/index.ts (EDITED)
  - BaplDmsPartStock: added optional dlrPrice/sgstPct/cgstPct/igstPct (client-side-merged, not part
    of the raw API response).
  - New BaplItemMaster interface matching ItemMasterController's JSON shape.

web/src/pages/staff/ItemMasterPage.tsx (NEW) - read-only browse/search page (debounced 300ms) with
  columns Item Code/Item Name/HSN Code/Dealer Price/SGST %/CGST %/IGST %/Type/Status.

web/src/components/StaffLayout.tsx (EDITED) - added a "🗂️ Item Master" sidebar entry right after
  "Parts & Inventory", scoped to the same roles as Part Upload (PartsUser/WorkshopManager/
  DealerAdmin/CorporateAdmin/SystemAdmin).

web/src/App.tsx (EDITED) - added the /item-master route (RequireRole-gated, same role list as the
  sidebar entry, matching ItemMasterController's own ServiceAdvisorUp backend policy).

web/src/pages/staff/PartsPage.tsx (EDITED) - "DMS Parts Inventory" table now also shows Dealer
  Price/SGST %/CGST %/IGST % per row (looked up from C_ItemMaster by Item Code, "—" when no match)
  - this closes the "still ... not fetched data from baplfinal" gap. This page's own local-catalog
  "Request" flow (top table) is untouched.

web/src/pages/staff/MaterialTransferCreatePage.tsx (MAJOR REWRITE)
  - Rate is now reverse-calculated from C_ItemMaster's Dlr_Price using that SAME item's own
    SGST/CGST/IGST (not a generic default split): rateFromDlrPrice(dlrPrice, totalGst) = dlrPrice /
    (1 + totalGst/100) - literally "Rate = Dlr_Price / (1+GST%)" per your wording.
  - New lineCalc() implements your worked example EXACTLY: without discount, Amount = MRP =
    Rate + GST on Rate (qty x). WITH a discount (new Discount Type %/₹ + value, per your request),
    the discount reduces Rate only; the GST rupee amount added back to compute Amount is the
    ORIGINAL amount computed on the UNDISCOUNTED Rate (never recalculated on the discounted Rate);
    MRP is always Rate+GST on the undiscounted Rate and never changes with a discount. Verified
    against your own numbers: Rate 100, GST 18% -> no discount: Amount=MRP=118. With 10% discount:
    discounted Rate=90, Amount = 90 + 18 (frozen) = 108, MRP stays 118.
  - Part Upload's BillPrice/BalAmount are NO LONGER used for Rate/MRP/GST - used only as a fallback
    when an item code has no C_ItemMaster match at all (disclosed in the code, not hidden).
  - Grid reordered/pruned exactly as asked: Item Code, Description, HSN Code, Issue Type, Qty,
    Rate, CGST Amt, SGST Amt, IGST Amt, Discount Type (%/₹) + value box, Amount, MRP. Rack No/
    Bin/Valid Days/Received input cells removed from this grid - NOT deleted from the data model or
    save payload (still visible via the existing "click a saved transfer" detail view), only hidden
    from this create grid since that's what you asked for.

web/src/components/LabourSearchInput.tsx (NEW) - a type-ahead combobox over DMS's own Labour
  Master (GET /api/bapl-dms/labour), modelled on the existing PartSearchInput.tsx. Closes a real,
  confirmed gap: Repair Bill's "Labour" item-type selector previously always searched the Parts
  list, never Labour Master.

web/src/pages/staff/RepairBillCreatePage.tsx (EDITED)
  - Same C_ItemMaster Rate/GST enrichment as Material Transfer for Part lines (pickPartForLine).
  - New pickLabourForLine: selecting "Labour" as a line's Type now shows LabourSearchInput instead
    of PartSearchInput for both the Item Code and Description cells ("when labor type select then
    Labour Code suggestion shown and when part selete then part" - now true). A picked labour row's
    Rate is set DIRECTLY from its own LabourRate (no reverse-GST calc - a labour rate card's rate is
    already GST-exclusive, unlike a Part's GST-inclusive Dealer Price/MRP), and its own Cgst/Sgst/
    Igst become that line's gstPct.

--------------------------------------------------------------------------------------------------
IMPORTANT - SCOPE DECISIONS I MADE, NOT YET CONFIRMED WITH YOU (Interpretation, flagged per policy)
--------------------------------------------------------------------------------------------------

1. Repair Bill's discount/GST calculation formula was LEFT UNCHANGED. Repair Bill still applies
   the standard "discount reduces the taxable amount first, then GST is calculated on what's left"
   formula (re-confirmed this round by re-reading RepairBillDocsController.Create's actual server-
   side calculation: discountAmt is subtracted from gross BEFORE cgst/sgst/igst are computed on the
   remainder) - this was verified against real pasted DMS reference source in an earlier round, and
   I did not want to silently overwrite already-verified behaviour based on an instruction that
   read (to me) as specific to Material Transfer's worked example. Only the Rate/MRP/GST-rate
   SOURCE changed for Repair Bill (now C_ItemMaster, same as Material Transfer) - the discount
   MATH itself is Repair Bill's original, different formula.
   ACTION NEEDED FROM YOU: if you actually want the SAME frozen-GST-on-discount formula (GST
   computed on the pre-discount amount, not recalculated on the discounted amount) applied to
   Repair Bill's Part/Labour lines too, tell me and I will change
   RepairBillDocsController.Create + RepairBillCreatePage.tsx's lineEstimate() to match Material
   Transfer's lineCalc() exactly. I did not do this without confirmation since it's a real change
   to a previously-verified calculation, not just a data-source change.

2. Material Transfer's CGST Amt/SGST Amt/IGST Amt columns, and the GST-inclusive Amount/MRP shown
   in the create grid, are FRONTEND-DISPLAY-ONLY - they are NOT persisted to the database. This was
   already true before this round (MaterialTransferDocItem has no CGST/SGST/IGST/tax columns at
   all, only Rate/Amount(=Qty x Rate, no GST)/Mrp - see that model's own doc comment, which already
   documented this as a disclosed, deliberate limitation matching the reference app's own
   MaterialTransfer table having no tax columns either). I did NOT change this schema this round -
   only the Rate/GST SOURCE (now C_ItemMaster) and the discount UI/math changed. Repair Bill, by
   contrast, ALREADY has real CgstAmount/SgstAmount/IgstAmount/TaxableAmount/TotalAmount columns on
   RepairBillDocItem and persists them - Material Transfer does not have the equivalent.
   ACTION NEEDED FROM YOU: if Material Transfer Bill's saved/printed record should also store its
   CGST/SGST/IGST amounts and the discount-adjusted, GST-inclusive Amount (the way Repair Bill
   already does), tell me and I will add those columns to MaterialTransferDocItem (a new
   self-healing ALTER TABLE block in Program.cs, following this project's existing no-EF-migrations
   convention - see the SELF-HEALING COLUMN MIGRATIONS block already there) and update
   MaterialTransferDocsController.Create to compute and store them the same way
   RepairBillDocsController.Create already does. This is a real, bounded follow-up, not done yet.

--------------------------------------------------------------------------------------------------
VERIFICATION
--------------------------------------------------------------------------------------------------
- Frontend: npx tsc --noEmit from web/ -> exit code 0, no errors (all files in this section).
- Backend: no `dotnet build` available in this sandbox (NuGet restore blocked by org egress
  policy) - BaplDealerService.cs and ItemMasterController.cs were manually reviewed field-by-field
  against this project's existing conventions (parameterized SQL, Microsoft.Data.SqlClient usage,
  DBNull handling, Policies.ServiceAdvisorUp usage, constructor DI patterns) rather than compiled.
  Please do a real `dotnet build` on your end before deploying.
- MaterialTransferDocsController.Create and RepairBillDocsController.Create's request DTOs were
  re-read this round and confirmed to still exactly match what MaterialTransferCreatePage.tsx's/
  RepairBillCreatePage.tsx's save() functions send - no DTO shape changed, so these two controllers
  did not need editing this round.

============================================================
SECTION 62 - Android: Item Master, Material Transfer Bill,
             Repair Bill (new screens) + Parts Catalog
             Dealer Price/GST% (2026-09-21, "add changes in
             android also")
============================================================

YOUR REQUEST: "in android also add changes" - i.e. bring this round's work (Item Master, Material
Transfer Bill/Repair Bill's C_ItemMaster-sourced calculation, Repair Bill's Labour Code search) to
the Android app. I asked one clarifying question first: the Android app had NO Material Transfer
Bill or Repair Bill screens at all before this (web-only features - only Dashboard, Job Cards, Job
Card Wizard/Detail and Parts Catalog existed on Android). You chose the full option: build brand
new Android screens for both, not just the smaller Parts/Item Master additions.

NO BACKEND CHANGES were needed for this section - every screen below posts to/reads from the EXACT
SAME endpoints web already uses (ItemMasterController, MaterialTransferDocsController,
RepairBillDocsController, /api/jobcards/search, /api/bapl-dms/parts, /api/bapl-dms/labour). Only
mobile/src files changed.

--------------------------------------------------------------------------------------------------
NEW FILES
--------------------------------------------------------------------------------------------------

mobile/src/screens/ItemMasterScreen.tsx - read-only browse/search over C_ItemMaster (GET
  /api/item-master), mirrors web's ItemMasterPage.tsx.

mobile/src/components/JobSearchModal.tsx - full-screen modal, debounced search against GET
  /api/jobcards/search - the Android counterpart of web's JobSearchModal.tsx, used by both create
  screens below to link a job card (auto-fills Party Name/Location/Reg No/Chassis No and the
  linked customer's State for tax auto-detection).

mobile/src/screens/MaterialTransferCreateScreen.tsx - create form + combined list
  (GET/POST/DELETE /api/material-transfer-docs...). lineCalc/lineTax are DIRECT, unchanged ports
  of web's MaterialTransferCreatePage.tsx functions - same frozen-GST-on-discount formula, same
  worked-number behaviour (Rate 100, GST 18%: no discount -> Amount=MRP=118; 10% discount -> 90 +
  18(frozen) = 108, MRP stays 118).

mobile/src/screens/RepairBillCreateScreen.tsx - create form + combined list (GET/POST/DELETE
  /api/repair-bill-docs...). lineEstimate/splitGst are direct ports of web's
  RepairBillCreatePage.tsx functions (discount-then-GST-on-remainder - the ORIGINAL Repair Bill
  formula, deliberately not the frozen-GST one - see SECTION 61's open question #1, which applies
  identically here). Selecting Type = Labour searches DMS's Labour Master (GET /api/bapl-dms/labour)
  via pickLabour, never the Parts list - Android never had the bug web's LabourSearchInput.tsx
  fixed, since this screen was built fresh this round with the fix already in place.

--------------------------------------------------------------------------------------------------
EDITED FILES
--------------------------------------------------------------------------------------------------

mobile/src/types/index.ts - added BaplItemMaster, JobSearchResult, CombinedRepairBillRow/
  RepairBillDocItemType, CombinedMaterialTransferRow/MaterialTransferDocType, extended
  BaplDmsPartStock with dlrPrice/sgstPct/cgstPct/igstPct/source/billPrice, added dealerState to
  CurrentUser (already returned by GET /api/auth/me, mobile just hadn't read it before) - all
  copied field-for-field from web/src/types/index.ts.

mobile/src/screens/PartsScreen.tsx - "DMS Parts Inventory" list now also shows Dealer Price/SGST%/
  CGST%/IGST% per row (same itemMasterByCode merge pattern as web's PartsPage.tsx fix).

mobile/src/navigation/RootNavigator.tsx - three new stack screens: ItemMaster,
  MaterialTransferCreate, RepairBillCreate.

mobile/src/screens/DashboardScreen.tsx - three new "+ Add" action cards on the dashboard (Item
  Master, Material Transfer Bill, Repair Bill) so the new screens are actually reachable - the
  sidebar-nav-item pattern web uses (StaffLayout.tsx) has no Android equivalent, so these use the
  same ActionCard tiles the existing Parts Catalog/New Job Card/Job Cards entries already use.

--------------------------------------------------------------------------------------------------
DELIBERATE DIFFERENCES FROM WEB (disclosed, not oversights)
--------------------------------------------------------------------------------------------------

1. UI SHAPE: web's Material Transfer/Repair Bill use a wide, spreadsheet-style editable grid - that
   doesn't fit a phone screen. Android instead uses an "add one line at a time" flow (search ->
   pick -> fill qty/discount/issue type -> "+ Add Line" -> line becomes a card in a list), the same
   pattern this app's own PartSuggestionSection.tsx/LabourSuggestionSection.tsx already use
   elsewhere. The underlying calculation (lineCalc/lineEstimate/splitGst) is an unchanged, direct
   port - only the input UI differs, not the math.

2. NO "Part Upload" merge into the Item Code picker on Android. Web's picker also searches parts
   uploaded via its own "Part Upload" tab (a web-only screen, merged with BalQty-based stock and a
   server-side balance decrement on save) - mobile has no Part Upload screen to manage or see the
   effect of that decrement, so its picker searches only live DMS PartsInventory
   (GET /api/bapl-dms/parts). IMPORTANT: this is a picker-display simplification only, not a
   calculation change - MaterialTransferDocsController.Create still runs its own
   PartUploads.BalQty decrement automatically server-side if a typed/picked Item Code happens to
   match a Part Upload row at that Location, exactly as it does when the save comes from web.

3. Rack No/Bin/Serial No/Valid Days/Received are not collected on the Android Material Transfer
   screen (always sent as null) - web already hides these from its own create grid too, per your
   own request this round (see SECTION 61) - they were never removed from the data model, just
   from both create UIs now.

4. Combined-list detail view: web has a dedicated RecordDetailModal popup; Android instead expands
   the tapped row in place (tap again to collapse) - same information (all line items from
   GET .../combined's `items` field), simpler control for a phone list.

5. Repair Bill's Delete button is gated to SystemAdmin on Android (hasRole('SystemAdmin')),
   matching RepairBillDocsController.Delete's own [Authorize(Policy = Policies.SystemAdminOnly)] -
   same restriction as web's canDelete. Material Transfer's Delete has no such extra role gate on
   either platform (matches MaterialTransferDocsController.Delete, which only blocks when the same
   job's repair bill is already Billed, with SystemAdmin bypassing even that).

--------------------------------------------------------------------------------------------------
VERIFICATION
--------------------------------------------------------------------------------------------------
- cd mobile && npx tsc --noEmit -> exit code 0, no errors (all 8 files in this section).
- No `expo`/Android emulator available in this sandbox to actually run/render the app - please
  smoke-test on a device/emulator before shipping: Dashboard -> new action cards navigate
  correctly; Item Master search returns rows; Material Transfer/Repair Bill "Add Line" computes
  the expected Amount/MRP/tax figures for a known item; Save actually posts and the combined list
  refreshes; Repair Bill's Type=Labour search returns Labour Master rows, not parts.
- Backend: unchanged this section - no new build/deploy step beyond SECTION 61's.

====================================================================================================
SECTION 63 - Fix: Item Code/Description field unselectable until a Location is resolved
  (Material Transfer Bill + Repair Bill, web only)
====================================================================================================

YOUR REPORT ("in repair bill and material transfer take Item Code from /item-master and with
Search Job below Item Code we cant select give proper changes"):
Below the "Search Job" control, the Item Code field could not be used at all until a Location was
already set.

ROOT CAUSE (confirmed in code, not assumed):
PartSearchInput.tsx (the shared Item Code/Description combobox used by both create pages) had
`disabled={!locationSelected}` on its input, and its match list was built ONLY from that Location's
live DMS stock (GET /api/bapl-dms/parts?locationCode=...) plus that Location's uploaded Part Upload
rows. Until a Job was picked with a resolvable Location (or a Location was chosen manually), that
list was empty and the field was disabled - so typing an Item Code before then genuinely could not
work, matching your report exactly.

FIX:
Item Code/Description search no longer depends on Location at all. It is now sourced primarily
from BAPL's own C_ItemMaster catalog (GET /api/item-master, confirmed dealer/location-agnostic -
see ItemMasterController.cs / SECTION 61) - fetched once per page load, independent of any
Job/Location selection. When a Location IS selected, live DMS stock and Part Upload rows for that
Location are still merged on top of the catalog entries (matched by Item Code) so availableQty,
the "Uploaded" badge, and stock-limit capping keep working exactly as before - this is additive,
not a replacement of the existing Location-scoped behaviour.

Each dropdown row is tagged to show where it came from:
  - "(stock: N)" + an "Uploaded" badge - your uploaded Part Upload stock report
  - "(stock: N)" with no badge - live DMS PartsInventory at the current Location
  - "(no stock loaded at this location)" + a "Catalog" badge - found in the Item Master catalog,
    but no live/uploaded stock row exists for it at the currently-selected Location (or no
    Location is selected yet). Rate/MRP/GST still compute correctly for these rows (from
    C_ItemMaster's own Dlr_Price/SGST/CGST/IGST, same formula as SECTION 61/62) - only the
    stock-quantity figure is unknown until a Location with a matching stock row is chosen.

FILES CHANGED:
- web/src/components/PartSearchInput.tsx - removed the `locationSelected` prop and its disabling
  logic entirely; dropdown rows now show a "Catalog" vs "Uploaded" source badge and an appropriate
  stock-quantity message per row.
- web/src/types/index.ts - BaplDmsPartStock.source widened from 'partUpload' to
  'partUpload' | 'itemMaster'.
- web/src/pages/staff/MaterialTransferCreatePage.tsx - added an `itemMasterCatalog` state fetched
  once on mount (GET /api/item-master, unfiltered); `parts` is now built as a two-pass merge
  (Item Master catalog seeded first, live DMS/Part Upload rows overlaid on top by Item Code) instead
  of only ever containing Location-scoped rows. Removed the now-invalid `locationSelected` prop from
  both <PartSearchInput> call sites (Item Code cell, Description cell).
- web/src/pages/staff/RepairBillCreatePage.tsx - identical fix: new `itemMasterCatalog` state/fetch,
  same two-pass `parts` merge, `locationSelected` removed from its two <PartSearchInput> call sites
  only. Its <LabourSearchInput> call sites (Labour Code/Description, when Item Type = Labour) are
  UNCHANGED and still require a Location - Labour Master search genuinely needs Location to resolve
  a dealerCode for GET /api/bapl-dms/labour, unlike Item Code search.

NOT CHANGED:
- No backend files touched - GET /api/item-master (SECTION 61) already returns the full,
  unfiltered catalog when called with no query string; this section only changes when/how the two
  create pages call it.
- Android's Material Transfer/Repair Bill screens (SECTION 62) still gate their own DMS-parts fetch
  and search UI on Location, same as web had before this fix - NOT addressed here since this
  report referenced the web screenshots specifically. Flagging in case you want the identical fix
  ported to Android; let me know and I'll do that as its own section.

VERIFICATION:
- cd web && npx tsc --noEmit -> exit code 0, no errors (all 4 changed files).
- No dev server available in this sandbox to click through the UI - please confirm on your end:
  Item Code field is typeable/selectable immediately on page load (before picking a Job or
  Location), catalog-sourced picks compute the correct Rate/MRP from C_ItemMaster, and picking a
  Location afterwards still shows live/uploaded stock quantities and the stock-limit cap as before.

====================================================================================================
SECTION 64 - Fix: Material Transfer/Repair Bill Rate/MRP was silently falling back to Part
  Upload's Bill Price instead of Item Master's Dealer Price (web only)
====================================================================================================

YOUR REPORT (with screenshots of Item Master's 0301-A01-1025 - Dealer Price Rs 242.00, SGST 9%/
CGST 9%/IGST 18% - vs Material Transfer picking the same Item Code and showing Rate Rs 130,
CGST/SGST Amt @9% of 130 = Rs 11.70 each): "without job search ans select in below accessible to
item code add serach and which dealer price are there in item-master that will not came in
material transfer dont take this calclation from parts-upload for clculation take item-master
rate , mrp , amount calculation correct this".

ROOT CAUSE (confirmed in code, not assumed):
SECTION 63's fix made the Item Code field itself selectable without a Location, but the actual
Rate/MRP calculation on pick still read Dealer Price/GST% off of a pre-merged, already-in-memory
`parts` list - which depends on TWO other pieces of client state that are not guaranteed to be
ready yet at the moment of picking:
  1. `itemMasterByCode` (the precise C_ItemMaster by-code enrichment) is a SEPARATE async fetch
     chained after the Location's live DMS stock + Part Upload rows have already loaded (three
     sequential round trips). A pick made quickly after typing could land before this third fetch
     resolved.
  2. `itemMasterCatalog` (SECTION 63's unfiltered catalog preload) is capped at TOP 1000 rows,
     ORDER BY ItemName (see ItemMasterController.cs/BaplDealerService.SearchItemMasterAsync) -
     C_ItemMaster is a large shared catalog, so an item whose name sorts past the first 1000 (e.g.
     0301-A01-1025, name "D15 RHS Cover...") is simply never in that preload at all.
When BOTH of those came back empty for the picked code, pickPartForLine's `dlrPrice` ended up null
and fell through to its "no C_ItemMaster match" branch - which, for a Part-Upload-sourced row,
used that row's own BillPrice (Rs 130 in your example) as Rate directly. That is exactly what you
saw: Item Master's real Dealer Price (Rs 242) never reached the bill even though it genuinely
exists in C_ItemMaster.

FIX:
Picking a Part (Material Transfer AND Repair Bill) no longer trusts any pre-merged/preloaded
client-side price data at all. It now fetches C_ItemMaster fresh, for the EXACT Item Code just
picked, at the moment of picking (GET /api/item-master/by-codes?codes=<one code> - a precise,
uncapped, single-purpose lookup, not the 1000-row catalog preload and not dependent on any other
effect having already resolved). Rate/MRP/SGST/CGST/IGST are now ALWAYS computed from that fresh
row:
  Rate = Dlr_Price / (1 + (SGST+CGST or IGST)/100), MRP = Dlr_Price (unchanged formula from
  SECTION 61/62 - only WHERE the numbers come from changed, not the formula itself).
Part Upload / live DMS stock rows now supply ONLY Item Code/Description/HSN/availableQty - never a
price - for both Material Transfer and Repair Bill, matching your instruction exactly ("dont take
this calclation from parts-upload").

If C_ItemMaster genuinely has no row at all for a picked Item Code (a real catalog gap, not a
stale-cache miss - the fresh by-code lookup would come back empty either way), Rate/MRP are left
as-is for manual entry rather than silently pulling a number from Part Upload - a new inline
warning explains why: "No Item Master (C_ItemMaster) price found for <code> - Rate/MRP left for
manual entry."

FILES CHANGED:
- web/src/pages/staff/MaterialTransferCreatePage.tsx - pickPartForLine rewritten as async; fetches
  /api/item-master/by-codes for the single picked code before setting Rate/MRP/SGST/CGST/IGST;
  added `priceWarning` state + inline warning row (next to the existing stock-limit warning).
- web/src/pages/staff/RepairBillCreatePage.tsx - identical fix to its own pickPartForLine (its
  single combined `gstPct` field is set from the same fresh SGST+CGST-or-IGST total); same
  priceWarning state/row added.

NOT CHANGED:
- The Rate/MRP formula itself (Rate = Dlr_Price / (1 + GST%/100), MRP = Dlr_Price) is UNCHANGED
  from SECTION 61/62 - this section only fixes WHERE the Dlr_Price/GST% values come from at pick
  time, not the arithmetic.
- Item Code/Description search itself (SECTION 63 - searchable without a Location/Job first) is
  unchanged and unaffected; this section is specifically about what happens once you PICK a result.
- The `itemMasterByCode`/`itemMasterCatalog` preloads from SECTION 61/63 are left in place (still
  used to show Dealer Price/GST in the search dropdown's own display and to merge in live/uploaded
  stock quantities) - they are simply no longer trusted for the actual Rate/MRP calculation, which
  now always re-fetches fresh and precise instead.

VERIFICATION:
- cd web && npx tsc --noEmit -> exit code 0, no errors (both changed files).
- Computed in Python (not estimated): for Dealer Price Rs 242.00, SGST 9%, CGST 9%, IGST 18% (your
  own 0301-A01-1025 example) -> total GST 18%, Rate = 242.00 / 1.18 = Rs 205.08, MRP = Rs 242.00,
  Amount (qty 1, no discount) = Rs 242.00 - matching Item Master's Dealer Price exactly, not Part
  Upload's Rs 130 Bill Price.
- No dev server available in this sandbox to click through the UI - please confirm on your end:
  picking 0301-A01-1025 (or any item with a known C_ItemMaster Dealer Price) now shows Rate ~Rs
  205.08 and MRP Rs 242.00, not Rs 130; picking an Item Code with genuinely no C_ItemMaster row
  shows the new "Rate/MRP left for manual entry" warning instead of a wrong number.

================================================================================
SECTION 65 - Repair Bill Part grid: auto-load from Material Transfer (no manual
Part search on Repair Bill), matching the real BAPL DMS reference architecture
================================================================================

YOUR WORDS: "now i saved from material transfer bill now this will shown in
repair bill with which i material transfer and from repair bill we can add only
labour from labour master in dropdown and that will add save as proforma" ...
"give proper flow for repair bill material transfer is ok now"

CONTEXT - confirmed from the real BAPL DMS production reference source you
pasted (RepairBillController.cs, RepairBillRepo.cs, repair-bill-service.ts,
repair-bill.ts/.html, repair-bill-list.ts/.html, repair-bill-invoice.ts/.html):
FACT - the reference's repair-bill.html has NO manual Part search dropdown at
  all - it is literally commented out in that file.
FACT - Parts are populated the moment a Job is selected, via
  loadMaterialedJobCardList() -> jobCardService.getMaterialedJobCardList(jobId,
  dealerCode) - i.e. pulled from whatever Material Transfer already exists for
  that job, not typed/searched on the Repair Bill screen itself.
FACT - only Labour has a live search-and-add flow on that screen (addLabour()
  against the Labour Master).
FACT - Part rows in the reference grid have an Edit action but no Delete action.

WHAT CHANGED (web only - this correction is scoped to the Repair Bill create
page; screenshots and reference source were both web):

1. backend/JobCardScanner.Api/Controllers/MaterialTransferDocsController.cs
   - New endpoint: GET /api/material-transfer-docs/for-job/{jobCardId}
   - Returns every Item row from every non-Cancelled Material Transfer Doc
     already saved against that Job Card, for the caller's own dealer
     (DealerId scoped, same as every other endpoint in this controller).
   - Flat list (MaterialTransferDocId/TransferNumber/TransferDate + each
     item's Id/ItemCode/ItemDescription/HsnCode/IssueType/Qty/Rate/Amount/Mrp)
     - this is the JobCardScanner equivalent of the reference's
     getMaterialedJobCardList().

2. web/src/types/index.ts
   - New MaterialTransferItemForJob interface matching that endpoint's shape.

3. web/src/pages/staff/RepairBillCreatePage.tsx - Part flow rewritten:
   - REMOVED: the manual Item Code/Description Part search UI (PartSearchInput
     wiring, dmsParts/uploadedParts/uploadedCodes fetches, the old synchronous
     itemMasterByCode/itemMasterCatalog-based pickPartForLine). Repair Bill no
     longer searches Parts itself, matching the reference exactly.
   - ADDED: a fetch of the new for-job endpoint whenever the linked Job
     (jobCardId) changes, plus a follow-up /api/item-master/by-codes lookup
     (same endpoint SECTION 64 already uses) to re-derive each Part row's
     GST% fresh from C_ItemMaster for the Taxable/CGST/SGST/IGST columns -
     Material Transfer's own item rows don't carry GST% (see
     MaterialTransferDocItem's own doc comment - by design, GST is computed
     live wherever it's shown, never persisted there), so Repair Bill has
     to look it up the same way Material Transfer's own display already does.
   - Part rows in the grid are now READ-ONLY: Item Code/Description/HSN/
     Qty/Rate all come straight from the Material Transfer item and cannot be
     typed or edited (each has a `readOnly`/tooltip explaining it comes from
     Material Transfer). Discount Type/Value and Issue Type remain editable
     per line, same as before, since the reference's own grid lets you set
     those per line too.
   - Part rows have NO Remove (X) button, matching the reference's "Edit only,
     no Delete" Part row - only manually-added Labour lines can be removed.
   - "+ Add Line" button relabelled "+ Add Labour" and now only ever creates a
     Labour-type row - Labour remains the one item type with a live search
     (LabourSearchInput, unchanged from before this section).
   - New inline warning (muted amber text, same style as the existing
     stock/price warnings elsewhere in this app) shown once a Job is linked
     and its Material Transfer fetch has completed with zero items: "No
     Material Transfer found yet for this Job Card. Parts must be issued via
     Material Transfer first - they will appear here automatically once
     saved. You can still add Labour below." This mirrors the reference's own
     onSelect() toaster ("Material Transfer is not completed for this Job
     Card") but is derived client-side from the already-fetched for-job list,
     not a new backend flag.
   - React key type for grid rows changed from number to string: manually-
     added Labour lines get "manual-N" (a useRef counter), auto-loaded Part
     lines use their own backend MaterialTransferDocItem GUID directly as the
     key - this keeps edits to Discount/Issue Type on a Part row intact across
     re-fetches (matched back to the same row by that same id) and guarantees
     no key collision between the two kinds of rows.

WHAT WAS DELIBERATELY NOT DONE (disclosed, not an oversight):
- INTERPRETATION, not Fact: no "already consumed by a Repair Bill" tracking
  was added between MaterialTransferDocItem and RepairBillDocItem (no FK, no
  IsUsedInRepairBill flag). Nothing in the pasted reference source or the
  existing codebase evidences this mechanism, and MaterialTransferDocItem has
  no such column today - adding one would be inventing an unconfirmed business
  rule. Practical effect: the same Material Transfer item will keep appearing
  on this Job's Repair Bill screen even if it was already billed once before
  (e.g. if the first Repair Bill was later cancelled and a new one started).
  Flag this back to us if BAPL DMS actually does track/prevent double-billing
  a transferred part - we did not see it in what was pasted.
- MaterialTransferCreatePage.tsx (Material Transfer's OWN creation screen) is
  UNCHANGED this section. Its manual Part search (SECTION 63/64) stays exactly
  as is - that screen is genuinely where Parts first enter the system, so it
  still needs a live search; this section's correction is specific to Repair
  Bill's grid, which should only ever consume what Material Transfer already
  produced, per the reference.
- Android's Repair Bill screen (SECTION 62) still has its own, separate Part-
  entry flow and was NOT touched this section - the screenshots and reference
  source you provided this time were web-only (repair-bill.html/.ts). Let us
  know if you want the same auto-load-from-Material-Transfer correction
  applied to the Android app's Repair Bill screen as a follow-up.

VERIFICATION:
- cd web && npx tsc --noEmit -> exit code 0, no errors, whole project.
- Grepped RepairBillCreatePage.tsx for every identifier removed in this
  rewrite (stockWarning/priceWarning/updateQty/availableQty/BaplDmsPartStock/
  PartUpload/PartSearchInput/rateFromMrp) - the only remaining matches are in
  doc-comment prose describing the OLD flow for context, none in live code.
- No dev server available in this sandbox to click through the UI - please
  confirm on your end: after saving a Material Transfer for a Job, opening
  Repair Bill and linking that same Job auto-fills its Part rows (read-only,
  "Material Transfer" badge, no X button) with the correct Item Code/
  Description/HSN/Qty/Rate/GST%; linking a Job with no Material Transfer saved
  yet shows the new amber warning instead of an empty/broken grid; Labour can
  still be searched and added/removed as before; Save still posts a Performa
  Repair Bill with both the auto Part rows and manually-added Labour rows.

FILES CHANGED:
- backend/JobCardScanner.Api/Controllers/MaterialTransferDocsController.cs -
  new GET for-job/{jobCardId} endpoint.
- web/src/types/index.ts - new MaterialTransferItemForJob interface.
- web/src/pages/staff/RepairBillCreatePage.tsx - Part flow rewritten to
  auto-load read-only rows from Material Transfer; Labour-only manual
  search/add/remove retained; new "no Material Transfer yet" warning.

================================================================================
SECTION 65 CORRECTION - two real compile errors slipped through, plus a
verification-process bug on my end that let them through undetected
================================================================================

WHAT HAPPENED: you reported two real TypeScript errors from your own editor in
RepairBillCreatePage.tsx:
  - Line 476: Cannot find name 'setStockWarning' (a leftover call to the
    priceWarning/stockWarning state I removed in SECTION 65's rewrite - I
    missed this one call site, inside the Save-success handler's field-reset
    block, since my earlier grep sweep for stray references happened to only
    match doc-comment prose elsewhere in the file, not this).
  - Line 480: setItems([emptyItem(1)]) - the same Save-success reset block
    still passed a number (1) as the new line's key, but DraftItem.key was
    changed to string this section (manual-N) - so this is a real type error,
    not a false positive.

BOTH ARE NOW FIXED:
  - setStockWarning(null) call removed (the state it referenced no longer
    exists anywhere in this file).
  - setItems([emptyItem(1)]) -> setItems([emptyItem('manual-1')]), with
    nextManualKeyRef.current reset to 2 alongside it, so a line added right
    after a Save gets key 'manual-2' and never collides with 'manual-1'.

THE MORE IMPORTANT ISSUE - why "npx tsc --noEmit" didn't catch this:
This project's tsconfig.json has "files": [] and only "references" to
tsconfig.app.json/tsconfig.node.json (a TS solution/project-references setup).
Plain `tsc --noEmit` against that root config does NOT follow references
unless run in build mode (`tsc -b`) - so every "npx tsc --noEmit -> clean, no
errors" I reported this session (SECTION 64 and SECTION 65 both) was checking
essentially nothing. It always exited 0 whether or not there were real errors,
which is why these two got through. The correct commands, which I re-ran just
now and which DID surface both problems: `npx tsc -p tsconfig.app.json
--noEmit` (finds this pair of errors) and `npx tsc -p tsconfig.node.json
--noEmit`. Both are clean now, genuinely - re-verified after the fix above.

I'm flagging this plainly rather than quietly fixing it: any prior "tsc clean"
claim in this README before this correction was not a real guarantee. Going
forward I'll use `npx tsc -p tsconfig.app.json --noEmit` (and the node
config) instead of the bare command.

FILE CHANGED (replaces the SECTION 65 copy in this same zip):
- web/src/pages/staff/RepairBillCreatePage.tsx

================================================================================
SECTION 66 - Labour search dropdown: code-only display, duplicate rows removed
================================================================================

YOUR WORDS: "in labour only labour code need to shown in dropdown and its
shown duplicate that also fix" (screenshot: typing "f" on a Labour line in
Repair Bill showed rows like "SFOM001 — FREE SERVICE (₹130)" with the exact
same code/description/rate appearing more than once in the list).

FILE CHANGED: web/src/components/LabourSearchInput.tsx (shared by
RepairBillCreatePage.tsx's Labour line and anywhere else this component is
used - no other file needed a change for this).

WHAT CHANGED:
- Dropdown row text dropped the " — <description>" segment - it now shows
  just the Labour Code and its rate, e.g. "SFOM001 (₹130)". The description
  is still available as a hover tooltip on the row (title attribute), not
  gone entirely, just not shown inline per your ask.
- Deliberately KEPT the rate in the row text rather than showing the code
  alone: your own screenshot has the same code (SFOM001) appearing with
  different rates (₹130 / ₹150 / ₹145) - those are NOT duplicates, they're
  genuinely different LabourMaster/PartWiseLabourMaster rows sharing a code
  (most likely one per OEM Model or Location the labour applies to - the
  upstream GET /api/bapl-dms/labour endpoint wasn't something I changed here,
  so I can't confirm the exact reason without looking at it). If the code
  were shown with nothing else, those would become visually identical and a
  dealer could pick the wrong one and bill at the wrong rate - so the rate
  stays as the one thing that still tells them apart.
- Real duplicates (same code AND same rate AND same source) ARE now removed:
  added a dedupe pass over the search matches keyed on
  labourCode+labourRate+source, keeping only the first occurrence. This is
  what was producing the exact repeated rows in your screenshot.

NOT CHANGED / NOT INVESTIGATED: why the backing labour list has duplicate
source rows in the first place (i.e. whether GET /api/bapl-dms/labour itself
is returning true duplicates from LabourMaster/PartWiseLabourMaster, or
whether this component was simply never deduping before). This fix removes
the symptom in the dropdown; if you want the root cause traced in the backend
query itself, send me that controller/service and I'll look.

VERIFICATION:
- cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors
  (using the corrected command - see SECTION 65's correction note above for
  why the plain `tsc --noEmit` doesn't actually check anything in this repo).
- No dev server available in this sandbox to click through the UI - please
  confirm on your end: typing "f" in a Labour line's search box now shows
  each distinct code+rate combination once, with just the code and rate
  visible (description on hover), and picking a row still fills
  Description/HSN/Rate exactly as before (pickLabourForLine itself is
  unchanged).

================================================================================
SECTION 67 - Repair Bill Labour dropdown: filtered to the job's own vehicle model
================================================================================

YOUR WORDS: after seeing the Labour Master admin screen (SFORUV1M001/M004/N001/N004, all tagged
Model "RUV 350 max"), you asked to add Model-based filtering to the Repair Bill labour dropdown -
so a job's labour search only offers codes that actually apply to that job's own vehicle model,
not every labour code across every model for the dealer.

WHAT CHANGED - web/src/pages/staff/RepairBillCreatePage.tsx only:
- FACT: JobSearchResult's `vehicleType` field is actually the vehicle's OEM Model name, not a
  vehicle category - confirmed directly in JobCardsController.Search: `VehicleType = j.Vehicle !=
  null ? j.Vehicle.Model : null`. Misleadingly named on that endpoint, left as-is rather than
  renamed (renaming it would touch every other place that already consumes this field across the
  app - out of scope for this fix).
- New `vehicleModel` state, set from `job.vehicleType` when a Job is linked (selectJob) and cleared
  alongside the rest of the job's state (clearJob).
- New `labourOptionsForModel` - the dealer-wide `labours` list narrowed to rows whose
  BaplDmsLabourRow.oemModelName matches vehicleModel (case-insensitive). Both LabourSearchInput
  usages (Item Code cell and Description cell) now receive this filtered list instead of the raw
  one.
- Deliberately does NOT hide a labour row when either side is unknown: no Job linked yet (
  vehicleModel null) shows everything, same as before this section; and a labour row with no
  oemModelName on file (a labour rate that isn't model-specific) always stays visible regardless of
  vehicleModel - only narrows when both are known and genuinely don't match, so this can't make a
  real, applicable labour code silently disappear from the picker.
- Small visible note added next to "+ Add Labour" ("Labour codes filtered to <model>") whenever
  narrowing is active, so the dealer can see why the list is scoped rather than wondering where a
  code went. Hidden entirely when no Job is linked.

NOT CHANGED: the /api/bapl-dms/labour endpoint itself and BaplDmsLabourRow's shape - filtering is
client-side only, over the same data this page already fetched. JobCardDetailPage.tsx's own Labour
Suggestion panel (which filters server-side by JobType/ServiceHead/ServiceType, not Model) is
untouched - this section only affects Repair Bill's own Labour picker.

VERIFICATION:
- cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors.
- No dev server available in this sandbox - please confirm on your end: linking a Job whose vehicle
  Model is on file (e.g. "RUV 350 max") narrows the Labour search to codes tagged for that model
  plus any untagged/generic codes; a Job with no Model on file (or none linked yet) shows every
  labour code, unchanged from before.

================================================================================
SECTION 68 - Extended Battery Warranty Scheme: new table + logic, native to JobCardScanner
================================================================================

YOUR WORDS: "needs to create warenty table in jobcardscanner db for this functionality and add
this in our function" - i.e. port the Extended Battery Warranty Scheme concept (which you earlier
pasted from BAPL DMS's own separate codebase, and I delivered as a text-only patch for THAT
codebase, since I don't have file access to it) into JobCardScanner's own database, which I do
have full access to, and wire it into Repair Bill.

WHAT THIS IS: a brand-new, dealer-configurable "Extended Battery Warranty Scheme" master table,
native to JobCardScannerDb (NOT a copy of any BAPL DMS table, NOT written to BAPLDMSvad/baplfinal).
Ported in SHAPE from the BAPL DMS reference you pasted, with two deliberate adaptations disclosed
below. A Repair Bill's Part lines are checked against it automatically and non-destructively.

FACT vs INTERPRETATION - please review before treating this as production-ready:
- FACT: JobCardScannerDb has no OEM Model master table (grepped Models/ and Controllers/ for
  "OemModel"/"VehicleModel" - nothing exists). Vehicle.Model is plain free text.
  => Scheme.VehicleModel is therefore free text too, matched case-insensitively against
  Vehicle.Model at save time. A typo in either place (scheme setup or the vehicle record) breaks
  the match silently - there is no FK to catch it. Recommend a naming convention (copy-paste the
  exact Model string from an existing Vehicle record) until/unless a real Model master exists.
- FACT: JobCardScannerDb already has an existing, SEPARATE, simpler field -
  Vehicle.Warranty.BatteryWarrantyExpiry (Models/MasterData.cs) - a single per-vehicle expiry date
  with no pricing or scheme concept. This new table does NOT read, write, or replace that field;
  they are two independent, additive concepts. Flagging this now so the two are never confused as
  the same feature.
- INTERPRETATION (carried over from the BAPL DMS delivery's own disclosure, not confirmed BGauss
  policy): FromDate/ToDate on a scheme are read as "which batch of vehicle purchases this scheme's
  pricing/terms apply to" - a scheme is a candidate only when the vehicle's own Purchase Date falls
  inside that window. Coverage for a claim = Purchase Date + Duration(DurationType), compared
  against the Repair Bill's own Bill Date; and the vehicle's odometer (Vehicle.Odometer) compared
  against the scheme's Kms cap (0 = no cap) - both conditions must pass to be "eligible". This
  formula should be checked against actual BGauss Extended Battery Warranty policy before being
  relied on for a real claim - I have not been given that policy and have not assumed one beyond
  what's written here.
- ASSUMPTION: PurchaseValidityDays is stored on the scheme (matching the BAPL DMS reference's own
  field) but NOT used anywhere in the eligibility check - same reason as the earlier BAPL DMS
  delivery: nothing confirms what it's meant to gate.
- Two adaptations from the BAPL DMS reference, not a 1:1 field copy: VehicleModel is free text
  (no OemModelId FK - see above) and DurationType is a plain string "Days"/"Months"/"Years" (not a
  numeric id into an unconfirmed lookup, avoiding the same ambiguity flagged in the BAPL DMS
  delivery's own README).

WHAT CHANGED:

Backend (all in backend/JobCardScanner.Api/):
- Models/ExtendedBatteryWarrantySchemes.cs (NEW) - the ExtendedBatteryWarrantyScheme entity. Full
  field list: SchemeName, VehicleModel, RateType, Duration/DurationType, Kms, DealerPrice,
  CustomerPrice, DiscountAmount, GstPercent, PurchaseValidityDays, BatteryPartCode, PartCode,
  FromDate/ToDate, IsActive, dealer/audit fields. See its own doc comment for the full reasoning.
- Models/RepairBillDocs.cs - RepairBillDocItem gets two new NULLABLE columns:
  ExtendedBatteryWarrantySchemeId and IsUnderExtendedWarranty. Both audit/display metadata only -
  NEVER change Rate/TaxableAmount/CgstAmount/SgstAmount/IgstAmount/TotalAmount, which stay exactly
  what the dealer entered. Existing rows unaffected (both nullable).
- Data/JobCardScannerDbContext.cs - new DbSet, new entity config (index on DealerId+VehicleModel,
  Dealer/CreatedBy/UpdatedBy FKs), and the new FK from RepairBillDocItem onto the scheme (kept at
  the global default Restrict, not Cascade - see next point).
- Dtos/Requests.cs - CreateExtendedBatteryWarrantySchemeRequest (create/update) and
  ExtendedBatteryWarrantyEligibilityResult (the eligibility check's response shape).
- Controllers/ExtendedBatteryWarrantySchemesController.cs (NEW) - CRUD
  (List/Get/Create/Update/Delete) plus GET .../eligible. Gated [Authorize(Policy =
  Policies.WorkshopManagerUp)] for the WHOLE controller - same confidentiality rationale as Labour
  Master (DealerPrice/CustomerPrice/DiscountAmount are pricing data). Delete is a real row removal
  (not a soft delete like RepairBillDoc) but is blocked with a 409 if any RepairBillDocItem still
  references the scheme - use Inactive instead for a scheme with claim history.
- Services/IExtendedBatteryWarrantyEligibilityService.cs + ExtendedBatteryWarrantyEligibilityService.cs
  (NEW) - the eligibility formula lives here ONCE, used by both the controller's GET .../eligible
  endpoint and RepairBillDocsController.Create's automatic tagging below, so the two can never
  silently drift apart as either is edited later. Registered in Program.cs's DI container.
- Controllers/RepairBillDocsController.cs - Create now, for each Part line only: if req.VehicleId
  resolves to a Vehicle with a Purchase Date on file, candidate schemes are evaluated once per
  save (not per line); a line is tagged when its own ItemCode equals a candidate scheme's
  BatteryPartCode or PartCode (case-insensitive). ExtendedBatteryWarrantySchemeId is set either
  way (so a bill line shows which scheme it matched, eligible or not) and IsUnderExtendedWarranty
  reflects the actual eligibility result. No VehicleId, no Purchase Date on file, or no matching
  scheme leaves both fields null - identical to a bill saved before this feature existed. Both new
  fields are also now included in the List/Get/Combined JSON responses (ToRow/ToCombinedRow).
- Program.cs - new, separate self-healing schema try/catch block (same idempotent
  IF OBJECT_ID(...)/COL_LENGTH(...)/sys.foreign_keys pattern used throughout this file, isolated
  so a failure here can't block any other startup block): creates
  dbo.ExtendedBatteryWarrantySchemes if missing, adds the two new RepairBillDocItems columns, adds
  the FK and an index. Runs on every startup in every environment, like every other block in this
  file - no manual SQL script to run by hand.

Frontend (web/src/):
- pages/staff/ExtendedBatteryWarrantySchemesPage.tsx (NEW) - admin list + create/edit form for the
  scheme master (Scheme Name, Vehicle Model, Rate Type, Duration/Duration Type, Kms cap, Dealer/
  Customer Price, Discount, GST%, Purchase Validity, Battery Part Code, Part Code, From/To Date,
  Active). This page is CRUD only - the eligibility check itself runs automatically inside Repair
  Bill save, there is no manual "check eligibility" button on this page (a live badge on the
  Repair Bill Part line itself was considered but not built - see NOT DONE below).
- App.tsx / components/StaffLayout.tsx - new route+nav entry "/battery-warranty-schemes" /
  "Battery Warranty Schemes", gated to WorkshopManager/DealerAdmin/CorporateAdmin/SystemAdmin,
  matching the backend policy exactly (same convention as every other gated page in this app).
- types/index.ts - ExtendedBatteryWarrantyScheme / CreateExtendedBatteryWarrantySchemeRequest /
  ExtendedBatteryWarrantyEligibilityResult, mirroring the new backend DTOs field-for-field.

NOT DONE (flagging rather than guessing at scope):
- No live "this line is now under Extended Battery Warranty" indicator was added to
  RepairBillCreatePage.tsx's Part grid itself - the tagging happens silently on save
  (RepairBillDocsController.Create) and is visible afterward via the bill's own Items (now
  carrying ExtendedBatteryWarrantySchemeId/IsUnderExtendedWarranty), not as a live badge while the
  dealer is still building the bill. Say the word if you want that added as its own section.
- No bulk import (Excel) for schemes, unlike Labour Master/Part Upload - this table is expected to
  hold a handful of dealer-defined schemes, not thousands of rows; can be added later if that
  assumption is wrong.

VERIFICATION:
- Backend: hand-reviewed only - no C# compiler available in this sandbox (NuGet restore blocked).
  Please build once merged in.
- Frontend: cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors, across the
  new page plus App.tsx/StaffLayout.tsx/types/index.ts.
- Please verify end-to-end once merged: (1) start the API once so the new table/columns appear
  (self-healing block runs on startup); (2) create a scheme under Battery Warranty Schemes for a
  Vehicle Model and Battery Part Code that match a real test vehicle/part; (3) create a Repair Bill
  against that vehicle with a Part line whose Item Code equals that Battery Part Code, and confirm
  the saved bill's item comes back with ExtendedBatteryWarrantySchemeId set and
  IsUnderExtendedWarranty true/false as expected, WITHOUT any change to that line's own
  Rate/TaxableAmount/TotalAmount; (4) confirm a scheme cannot be deleted once referenced by a
  saved bill line (409), and that Inactive still works as the "retire" path instead.

================================================================================
SECTION 69 - Repair Bill: "Save as Proforma" then "Save as Invoice" lifecycle
================================================================================

YOUR WORDS: "in repiar bill save as proforma and after save as proforma then save as invoice that
same functionality we need to create in our jc" - the reference DMS app's own two-step Repair Bill
lifecycle (save a Proforma first, finalize it as an Invoice afterwards), read as a SEQUENCE on the
SAME bill, not two independent create-time buttons.

WHAT CHANGED:

FACT (checked before building this): RepairBillDocsController already had a
`PUT /api/repair-bill-docs/{id}/status` endpoint (UpdateStatus) that moves a bill's Status between
Performa/Billed/Cancelled - it was written earlier this session but NO page anywhere in the app
ever called it. So this section is entirely FRONTEND wiring onto an existing, already-correct
backend endpoint - no backend files changed.

- web/src/pages/staff/RepairBillCreatePage.tsx:
  - The create-form button is relabelled "Save Repair Bill" -> "Save as Proforma". Behaviour is
    UNCHANGED - it always creates the bill with Status=Performa (the backend hard-codes this on
    Create regardless of what's sent), exactly as before this section; this is a label-only change
    to make the two-step lifecycle explicit in the UI.
  - New "Save as Invoice" action, reachable by clicking a bill row to open its detail popup (the
    existing "click to view full details" flow) - a button now appears at the bottom of that popup
    ONLY when the bill is this app's own (Source = JobCardScanner, not a DMSBAPLDATA-synced row)
    AND its Status is still Performa. Clicking it, after a confirm prompt, calls the existing
    PUT .../status endpoint with "Billed" and refreshes both the popup and the list below.
  - This does NOT add a line-item edit screen. "Save as Invoice" finalizes the STATUS only - Rate/
    Qty/GST/discount cannot be changed at that point (this app still has no edit-bill screen at
    all, only create/status-change/delete, per this page's own pre-existing doc comment). If a
    Proforma bill's line items are wrong, today's only options are re-entering a fresh bill, or
    (SystemAdmin) deleting it - flagging this rather than quietly building a bigger edit feature
    you didn't ask for.
- web/src/components/RecordDetailModal.tsx - added an optional `actions` prop (a footer row below
  the fields/items, only rendered when passed) so Repair Bill's "Save as Invoice" button has
  somewhere to live. Purely additive - PartUploadPage.tsx and MaterialTransferCreatePage.tsx's own
  uses of this shared component don't pass it and render exactly as before.

NOT CHANGED: RepairBillDocsController.UpdateStatus itself (already correct/unused before this
section) and RepairBillDocStatus's three values (Performa/Billed/Cancelled) - no "Cancelled" UI
was added since you only asked for the Proforma -> Invoice step; say the word if you also want a
"Cancel Bill" action surfaced the same way.

VERIFICATION:
- cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors.
- No dev server available in this sandbox - please confirm on your end: (1) "Save as Proforma"
  still creates a bill exactly as before, status shows "Performa" in the list; (2) clicking that
  row opens the detail popup with a "Save as Invoice" button at the bottom; (3) clicking it,
  confirming, updates the row's Status to "Billed" in the list and the button disappears from the
  popup on next open (status no longer Performa); (4) a DMSBAPLDATA-sourced row, or a bill already
  Billed/Cancelled, shows no "Save as Invoice" button at all.

================================================================================
SECTION 70 - Repair Bill UI clean-up: column naming, hide Tax Type/Issue Type default
selectors, "Selected Job Details" panel after Job Search
================================================================================

YOUR WORDS (pasted alongside two screenshots of the real BAPL DMS reference's own /repair-bill
page): "AMount and Rate colums also shown in table give proper in after IGST Amt proper heading
name ..Tax Type hide dont show in ui automatically login dealer state wise it select and Issue
Type (default for new lines) that also hide..in labour after jobcard serach this automatically
details fetch then we adding labour details see screenshot that type add ui and all"

Four separate asks in that message - the first three are done below; the fourth (matching the
screenshot's own Labour/Part "add" UI exactly) needs a scoping decision from you first - see the
question I'm asking alongside this delivery.

WHAT CHANGED (web/src/pages/staff/RepairBillCreatePage.tsx unless noted):

1. Column heading after IGST Amt: renamed "Est. Total" -> "Net Amount", matching the reference
   screenshot's own Labour Details List column name (its Part Details List calls the equivalent
   column "Amount" - close enough to the same concept that one shared name across both Labour and
   Part rows in our single combined grid is clearer than switching the header per row type). The
   "still a live estimate, not final until Save" meaning is now carried as a hover tooltip on the
   header instead of the word "Est." - the bill-level "Estimated Total: ₹X" caption below the grid
   (unchanged) already says this plainly in words.

2. Tax Type selector removed from the visible form. FACT: this page already auto-detected Same
   State (CGST+SGST) vs Different State (IGST) from comparing the signed-in dealer's own State
   against the linked job's Customer.State (built 2026-09-21) - the dropdown you're looking at in
   your screenshot was only ever a manual OVERRIDE on top of that auto-detection, which is exactly
   what you're now asking to remove. The underlying computation is UNCHANGED (same compare, same
   default of Same State when either state isn't known yet, e.g. no job linked) - it's now a plain
   derived value instead of state you could edit, since there's no control left to edit it from.

3. "Issue Type (default for new lines)" selector removed from the visible form. This was a
   bill-level convenience that pre-filled new Labour lines' own Issue Type - each LINE's own Issue
   Type selector (Paid / U/W / FSC, in the item grid itself) is UNTOUCHED and still fully
   controllable per line; only the bill-level default picker is gone. Since nobody using this
   picker was required, hiding it simply means every new line now starts at "— default —" (which
   already meant "falls back to Paid/no zero-tax behaviour" before this change too).

4. NEW "Selected Job Details" read-only panel, shown once a Job is linked via Job Search - Job
   Date, Job No., Reg No, Model, KMs, Chassis, Technician, matching the reference screenshot's own
   panel field-for-field. FACT: KMs (Vehicle.Odometer) and Technician (JobCard.AssignedTechnicianName)
   both already existed as real columns on this app's own Vehicle/JobCard tables but were never
   returned by the Job Search endpoint before now - backend/Controllers/JobCardsController.cs's
   Search() action now also returns Odometer and Technician (real data pulled from those existing
   columns, nothing invented). Job Date/Job No/Reg No/Model/Chassis were already available and are
   simply displayed here too, read-only, ALONGSIDE the existing editable Party Name/Reg No/Chassis
   No/Location fields below (which remain the real, editable source of truth saved on the bill -
   this panel is a recap, not a second set of inputs, so there's no duplicate-editing risk).

NOT YET DONE - see my question alongside this delivery: matching the screenshot's own Labour/Part
"add" UI exactly (a dedicated staging input row with its own +Add button, feeding a separate
read-only "Details List" table with Edit/Delete icons per row) is a bigger, structurally different
change from this page's current single inline-edit grid, and Part lines specifically are already
built to auto-load read-only from Material Transfer with no manual add at all (per an earlier
section this same session) - the reference's own Part-adding row wouldn't apply to them the same
way. I didn't want to guess at how far to take that redesign and risk breaking what's already
working, so I'm asking first rather than rebuilding it silently.

VERIFICATION:
- cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors.
- npx oxlint (this project's configured linter, not eslint directly) on every file touched this
  section -> zero warnings.
- No dev server available in this sandbox - please confirm on your end: (1) linking a Job via Job
  Search shows the new "Selected Job Details" panel with real KMs/Technician values (or "—" when a
  job card has neither on file yet - not blank/broken); (2) Tax Type/Issue Type-default fields are
  gone from the form but CGST/SGST/IGST split still comes out correct for both a same-state and a
  different-state customer, same as before this section; (3) the item grid's last column now reads
  "Net Amount" instead of "Est. Total" with the same live-updating values as before.

================================================================================
SECTION 71 - Repair Bill: Labour/Part "add" UI redesigned to match the reference screenshot
================================================================================

YOUR ANSWER to the scoping question asked alongside SECTION 70: "Redesign both Labour and Part
display" (the third option - full redesign of both, not just Labour, and not "keep as-is").

WHAT CHANGED (web/src/pages/staff/RepairBillCreatePage.tsx only):

The old single inline-edit grid - one table where every line, including a not-yet-added one, was
edited directly in its own row - is replaced by the reference's own two-part pattern, per your
screenshots:

- Labour: a dedicated "staging row" above a new "Labour Details List" table - Labour (search),
  Description, Qty, Rate, Disc. Type, Discount, Issue Type, then a "+ Add" button, matching the
  reference's addLabour() exactly. Clicking a row's own pencil (Edit) icon in the list below loads
  that line back into the staging row (button becomes "Update"); a trash icon deletes it directly.
  The Labour Details List table itself is now pure read-only display (Sr.No/Labour Code/
  Description/Qty/Rate/HSN Code/Discount Amt./Disc.Type/CGST Amt./SGST Amt./IGST Amt./Net Amount) -
  no more editable cells sitting inside it.
- Part: DATA AND BEHAVIOUR ARE UNCHANGED - still auto-loaded read-only from whatever Material
  Transfer was already saved against the linked Job (no search box, no manual add - this was a
  deliberate, confirmed correction earlier this session: the reference's own Part-adding UI is
  commented out of its source and Parts there load the same way). Only the TABLE was restyled into
  its own separate "Part Details List" with the reference's column set (Action/Sr.No/Part No./
  Description/Qty/Rate/HSN Code/MRP/Discount/Discount Type/CGST Amt./SGST Amt./IGST Amt./Amount/
  Issue Type/GST %). Its pencil icon toggles ONLY Discount/Issue Type into inline inputs on that
  one row (the only fields ever editable on a Part line, same rule as before this section) - there
  is still no Delete icon for a Part row, matching the reference.
- FACT, flagged rather than silently worked around: the reference's Part Details List also shows a
  "FOC Rate" column. This app's RepairBillDocItem has no equivalent field at all (checked the
  model - there's no FOC/free-of-cost concept stored anywhere on a Repair Bill line), so that
  column is OMITTED here rather than displaying a fake/always-empty one. Say the word if FOC
  tracking is something you actually need captured - that would be a new backend field, not a
  display change.
- The bill's saved data shape is completely unchanged - `items` (the array actually sent to
  POST /api/repair-bill-docs on Save) still holds the exact same Labour/Part line objects as
  before; only how they're ADDED/EDITED/DISPLAYED changed. Nothing about SECTION 68's Extended
  Battery Warranty Scheme tagging, SECTION 69's Save as Proforma/Invoice, or SECTION 70's Tax Type/
  Issue Type-default/Selected Job Details work needed to change alongside this.

VERIFICATION:
- cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors.
- npx oxlint src/pages/staff/RepairBillCreatePage.tsx -> zero warnings.
- No dev server available in this sandbox - please confirm on your end: (1) the Labour staging row
  adds a new row to Labour Details List on "+ Add" and clears itself; (2) clicking a Labour row's
  pencil loads it back into the staging row, "+ Add" becomes "Update", and saving there updates
  that same row in place (not a duplicate); (3) the trash icon removes a Labour row; (4) Part
  Details List still populates automatically from a saved Material Transfer with no way to
  manually add a Part row, and its pencil icon only lets you change Discount/Issue Type; (5) Save
  as Proforma still posts the correct combined Labour+Part items exactly as before this section.

================================================================================
SECTION 72 - OEM Model Master + OEM Model Warranty (new tables in JobCardScannerDb),
              linked to Extended Battery Warranty Scheme
================================================================================

YOUR REQUEST (verbatim): "this wants to integrate for my battery-warranty-schemes for link models
for warrenty and this all table add in jobcard db that all functionality need to craete in jc" -
alongside a full paste of the real BAPL DMS reference's OemmodelMaster + OemmodelWarranty tables,
Angular list/add/edit screens, and C# controller/repo/service/viewmodel layers.

Before building this I asked 3 scoping questions (AskUserQuestion) because the schema/scope
decisions here are hard to reverse once data exists. YOUR ANSWERS, all "Recommended":
  1. OEM Model Master scope: GLOBAL (one shared catalog, not per-dealer) - matches the reference
     table's own shape (it has no DealerId at all).
  2. Vehicle.Model (the existing free-text field used across the whole app - wizard, vehicle
     records, etc.): STAYS FREE TEXT, unchanged. Only the new warranty-linking features use the
     new OEM Model FK.
  3. ExtendedBatteryWarrantyScheme's existing free-text VehicleModel column: a new OemModelId FK
     is ADDED ALONGSIDE it, not replacing it - nothing about existing schemes breaks.

WHAT WAS BUILT:

1. TWO NEW TABLES, native to JobCardScannerDb (self-healing schema, same pattern as every other
   table added this session - see Program.cs's new "OEM MODEL MASTER + OEM MODEL WARRANTY" block):

   dbo.OemModels (GLOBAL - no DealerId):
     Id, ModelName (required, unique), ModelShortName, IsActive, CreatedById/CreatedAt/
     UpdatedById/UpdatedAt (FK to Users, this app's own audit convention - the reference used raw
     CreatedBy/UpdatedBy ints from its own separate user table).

   dbo.OemModelWarranties (the OEM's own STANDARD warranty terms per model - separate from the
   dealer-priced Extended Battery Warranty Scheme, same distinction the SECTION 68 doc comment
   already draws against Vehicle.Warranty.BatteryWarrantyExpiry):
     Id, OemModelId (FK, Cascade delete - a warranty term is owned by its model), EffectiveDate,
     OdoReading, DurationType ("Months"/"Years" only - see below for why not "Days" too), Duration,
     IsB2b, same CreatedBy/UpdatedBy audit columns.
     BUSINESS RULE (ported from the reference's add-oemmodel-warranty.ts): a new EffectiveDate for
     a model must be strictly AFTER that model's most recent existing EffectiveDate. The reference
     only enforces this client-side (an HTML min= attribute); this build enforces it SERVER-SIDE
     too (OemModelWarrantiesController.Create/Update), since a client-only check is trivially
     bypassed by a direct API call - flagging this as a deliberate hardening beyond the reference,
     not a change to what the rule means.

   FACT/ADAPTATION disclosed in Models/OemModels.cs's own doc comment: the reference's
   DurationType was a numeric FK into a frontend-only, never-confirmed lookup whose real values
   were never verified (same gap already flagged for ExtendedBatteryWarrantyScheme.DurationType
   back in SECTION 68). Kept as a plain string here, restricted to "Months"/"Years" only (NOT
   "Days" - the reference itself never offered Days for this specific table, unlike Extended
   Battery Warranty Scheme's own DurationType which does).

2. LINKING TO Extended Battery Warranty Scheme (per your answer #3):
   - ExtendedBatteryWarrantyScheme gained a new nullable OemModelId column (FK, Restrict) ALONGSIDE
     its existing VehicleModel free-text column. VehicleModel is still required and still the ONLY
     field ExtendedBatteryWarrantyEligibilityService reads for matching - nothing about eligibility
     MATCHING changed.
   - The admin page (ExtendedBatteryWarrantySchemesPage.tsx) now has an "OEM Model (optional)"
     dropdown next to the Vehicle Model text box. Picking a model sets OemModelId AND auto-fills
     Vehicle Model from that model's real name, so the two stay in sync going forward. Manually
     retyping Vehicle Model clears the OemModelId link (since it may no longer match a catalog
     entry) - existing schemes with no matching OEM Model row keep working exactly as before,
     shown as "Unlinked" in the list.

3. AUTHORIZATION (both new controllers, OemModelsController/OemModelWarrantiesController):
   GLOBAL master data, so List/Get are gated at WorkshopManagerUp (any dealer's own Workshop
   Manager can browse the catalog to link a scheme) but Create/Update/Delete are additionally
   gated at the stricter CorporateAdminUp - a catalog shared by every dealer shouldn't be editable
   by dealer-level staff. This "controller-level policy + a stricter one stacked on specific
   actions" is NOT a new convention invented for this feature - it's the exact same pattern
   ReportsController.ExportInvoices already uses in this codebase (ReportsController is
   [Authorize(Staff)], but ExportInvoices itself additionally requires CashierUp).

4. CRUD + Excel download for both new masters (OemModelsController/OemModelWarrantiesController -
   direct-_db pattern, matching ExtendedBatteryWarrantySchemesController's own rationale: these
   tables live in JobCardScannerDb, not BAPLDMSvad/DMSBAPLDATA, so no repo/service layer). Excel
   export uses this app's EXISTING IExcelExportService (the same service ReportsController already
   uses) - no new export mechanism invented. OEM Model Master delete is blocked (409) if any
   Extended Battery Warranty Scheme still references it (mark Inactive instead); OEM Model
   Warranty delete has no such block (nothing else in this app references it).

5. TWO NEW ADMIN PAGES (OemModelsPage.tsx / OemModelWarrantiesPage.tsx), routed at /oem-models and
   /oem-model-warranties, with nav entries in StaffLayout.tsx (same WorkshopManagerUp+ role gate as
   the route - App.tsx). OemModelWarrantiesPage has the model dropdown, an Effective Date
   date-range filter (matching the reference's own filter), the same min-date UI hint as the
   reference (with the real enforcement server-side, per #1 above), and an Excel download button.

FACT (checked, not assumed): grepped this codebase before starting - no OemModel/VehicleModel FK
of any kind existed anywhere before this section, confirming the gap SECTION 68's own doc comment
already flagged ("no OEM Model master exists in JobCardScannerDb").

NOT DONE (by your own explicit choice, answers #2 and #3 above) - flagging so it's not mistaken
for an oversight: Vehicle.Model itself is NOT an FK and has no dropdown anywhere in this app - a
vehicle's model is still typed free text exactly as before this section. If you later want new
vehicles to be picked from this same OEM Model catalog too, that's a separate, larger change (Job
Card Wizard, Vehicle add/edit screens, Android app) and would need its own scoping pass, the same
way this one did.

VERIFICATION:
- cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors.
- npx oxlint on every web file touched this section (OemModelsPage.tsx, OemModelWarrantiesPage.tsx,
  ExtendedBatteryWarrantySchemesPage.tsx, App.tsx, StaffLayout.tsx, types/index.ts) -> zero new
  warnings (StaffLayout.tsx carries two PRE-EXISTING warnings unrelated to this section's edits -
  a Fast Refresh export-shape warning and a set-state-in-effect warning, both already present
  before this change, not introduced by it).
- Backend: `dotnet build` was attempted directly this time (dotnet 8.0.130 is present in this
  sandbox) but NuGet restore is blocked by this environment's network policy (api.nuget.org
  returns 403 via the sandbox's proxy) - so this is still a careful hand-review, not a compiled
  build, same limitation as every earlier section. Please run an actual `dotnet build` on your end
  before deploying.
- Please confirm on your end after merging: (1) OEM Models page loads, and a CorporateAdmin/
  SystemAdmin login can create/edit/delete a model while a plain WorkshopManager login can view
  the list but gets a 403 trying to save (by design - see #3 above); (2) OEM Model Warranty page's
  Effective Date min-date hint updates correctly per selected model, and saving a date on/before
  the last one for that model is rejected with a clear message from the server; (3) on the
  Extended Battery Warranty Scheme page, picking a model from the new dropdown fills Vehicle Model
  correctly, and an existing (pre-this-section) scheme still opens/saves fine with "Unlinked"
  shown for its OEM Model column; (4) the self-healing schema block in Program.cs actually creates
  both new tables + the new OemModelId column on your real database on next app startup (check the
  startup console log for the "[Startup] Self-healing schema catch-up (OemModels +
  OemModelWarranties tables...)" line).

================================================================================
SECTION 73 - Repair Bill page: Labour row spacing fix, auto-filled fields made
              read-only, Part Details List gets a working Delete, page made "attractive"
================================================================================

YOUR REQUEST (verbatim, two messages):
1. "in this page css not proper in Labour after Qtyfeild have much space that all feilds fix in 1
   link with Add button ..Party Name *,Reg No Chassis No,Location that also auto fetched feild
   that also dont show editable only this page give me after fixing"
2. "and in Part Details List with edit delete button also add and proper give me this page
   attractive page"

WHAT CHANGED (web/src/pages/staff/RepairBillCreatePage.tsx only):

1. LABOUR ROW SPACING - FACT, root cause found: the Labour staging row used the page's own
   .form-row class, whose CSS (styles/global.css) is an equal-width grid -
   `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))` - so even a tiny field like Qty
   or Disc. Type was stretched out to at least 200px, leaving a lot of visible empty space and
   uneven wrapping after Qty. Fixed by switching to .suggest-row + .field-grow/.field-compact -
   NOT a new class invented for this: it's the exact SAME fix already used for this exact same
   problem on the Job Card Detail page's own "Suggest a part"/"Suggest labour" rows
   (JobCardDetailPage.tsx). Labour/Description now grow to fill space, Qty/Rate/Disc.Type/
   Discount/Issue Type/Add size to their own content - the whole row now reads as one compact
   line instead of a stretched-out grid.

2. Party Name / Reg No / Chassis No / Location now become READ-ONLY the moment a Job is linked
   (new `autoFilledFromJob` = `!!jobCardId`) - matching your ask that an auto-fetched field
   shouldn't also look freely editable. Each field shows a tooltip ("Auto-filled from the linked
   Job - unlink the Job to edit."). Unlinking the Job (the existing ✕ button next to Job No) hands
   editing back immediately, for a standalone bill with no Job - these fields work exactly as
   before this section whenever no Job is linked.

3. Part Details List DELETE button - FACT, explicit departure from the reference disclosed rather
   than silently added: every earlier section's own doc comments said the reference's own Part
   Details List has Edit only, no Delete, and this app matched that on purpose. You've now asked
   for Delete there too, so it's added - a ✕ icon next to the existing pencil (Edit) icon, same
   style/placement as Labour's own Edit+Delete pair. IMPORTANT - what Delete actually does: a Part
   row here is a read-only reflection of a real Material Transfer record, and this app has no
   "undo a transfer" concept - so Delete only EXCLUDES that part from THIS bill (it won't be
   billed/sent to the backend on Save), it does NOT reverse, cancel, or edit the underlying
   Material Transfer itself. The confirm dialog says this in the wording, and the exclusion is
   remembered (excludedPartKeys) so the row doesn't silently reappear if the page re-fetches
   Material Transfer data later in the same session; it resets automatically whenever you link a
   different Job (or unlink the current one) or after a bill is saved.

4. "attractive page" - the flat run of .form-rows had no visual grouping, so the three logical
   sections (Job & Bill Details / Labour / Part Details List) now each sit in their own bordered,
   colour-accented panel with an icon + title (and a live count badge for Labour/Part). Reuses
   this app's own EXISTING design tokens only (--border/--radius-sm/--primary/--accent-2/
   --accent-3 from styles/global.css) - no new colors or CSS file changes, purely a visual
   regrouping of fields/tables that were already there. This is presentation only - no field,
   calculation, or save behaviour moved or changed.

NOT CHANGED: item/save data shape, tax/GST calculation, the Job Search flow itself, the Labour
staging-row add/edit logic, or the Part auto-load-from-Material-Transfer behaviour - all exactly
as delivered in SECTION 71/72.

VERIFICATION:
- cd web && npx tsc -p tsconfig.app.json --noEmit -> exit code 0, no errors.
- npx oxlint src/pages/staff/RepairBillCreatePage.tsx -> zero warnings.
- No dev server available in this sandbox - please confirm on your end: (1) the Labour staging row
  now sits on one compact line with Qty/Rate/Disc.Type/Discount/Issue Type/Add all close together,
  no large gaps; (2) linking a Job via Job Search turns Party Name/Reg No/Chassis No/Location
  read-only (grey/non-editable), and unlinking the Job (✕) makes them editable again; (3) a Part
  row's new ✕ (Delete) removes it from the Part Details List and from the Estimated Total, and
  Saving as Proforma afterwards does NOT include that part in the saved bill, while the original
  Material Transfer record is untouched; (4) deleting a Part row, then unlinking and re-linking
  the SAME Job, brings that part back (exclusion is per-Job-selection, not permanent); (5) the
  three new bordered panels (Job & Bill Details / Labour / Part Details List) render with visible
  left-border color accents and don't break on a narrow/mobile-width screen.


================================================================================================
SECTION 74 - Part Upload "MT Transfer Qty" column + Labour Master Partwise integrated into
Material Transfer, flowing into Repair Bill (web AND mobile)
================================================================================================

Your requests (verbatim):
1. "in parts-upload page after Bal Qty column add MT Transfer Qty column for maintaining how much
   qty was transfered.."
2. "then from /labour-master from this page which Rate Type * is Partwise from this we upload FOR
   Part Code add Labour Code also that was wants to integrate in material transfer which in video
   and which labour we added from amterial transfer for Issue Type - Paid that will goin for paid
   type and which are in U/w that was going in U/w that also going in repair bill ..give proper
   code like vide functionality in mobile and for web both give proper"

Before implementing request 2, two clarifying questions were asked (large/architecturally-
ambiguous requests are scoped up front on this project, per your own earlier feedback) and you
answered:
  - Build sequencing: "Web and mobile together, one delivery" (not web first).
  - Part Code -> Labour Code match scope: "Part Code only (Recommended - matches the video
    exactly)" - not also filtered by Vehicle Model.

You also attached a screen recording (mt-labour_add.mp4) of the real BGauss DMS reference app
(mydmsconnect.com/MtrlTranN.aspx) - watched via extracted frames (no video-playback tool exists
in this sandbox) to confirm the exact reference workflow before writing any code, rather than
guessing at it. FACT, confirmed from those frames: on Material Transfer, after picking a Part and
setting its Issue Type, a "Labour" button opens a "Labour List" popup titled "Part wise Labour
Detail (@Item Name <PartCode> - <PartName>)" with a Labour Name/Description/Rate/Technician
picker and an Add-then-stage flow, committed via "Proceed".

------------------------------------------------------------------------------------------------
PART 1 - Part Upload "MT Transfer Qty" column (web only - no mobile Part Upload screen exists)
------------------------------------------------------------------------------------------------

New read-only column added right after "Bal Qty" in the Part Upload results grid, export, and
detail modal, showing the total quantity of that uploaded part already transferred out via
Material Transfer at the same Location.

WHAT CHANGED:
- backend/JobCardScanner.Api/Models/PartUploads.cs - new `[NotMapped] MtTransferQty` property on
  PartUpload. NOT a stored column - computed fresh on every GET.
- backend/JobCardScanner.Api/Services/PartUploadService.cs - `GetAsync` now calls a new
  `AttachMtTransferQtyAsync` after loading each page of rows, which sums
  `MaterialTransferDocItems.Qty` grouped by (ItemCode, Location), matched against each row's
  (PartNo, LocationCode) - the SAME match key `MaterialTransferDocsController.Create`'s own
  `partUploadCache` lookup already uses to decrement `PartUploads.BalQty`, so this column's number
  is consistent with what actually drove that decrement.
- web/src/types/index.ts - `mtTransferQty: number | null` added to the `PartUpload` interface.
- web/src/pages/staff/PartUploadPage.tsx - column added to the grid header/body (right after Bal
  Qty), the CSV/Excel export columns, and RecordDetailModal's field list; empty-state colSpan
  bumped 10 -> 11.

INTERPRETATION flagged explicitly: the sum deliberately INCLUDES items from Cancelled Material
Transfer docs, not just Draft/Confirmed ones. Reason: `MaterialTransferDocsController.Delete`
restores `PartUploads.BalQty` when a transfer is deleted, but the Cancel status transition
(`UpdateStatus`) does not restore it - so if Cancelled rows were excluded from this column's sum,
the number shown would understate what has actually been deducted from Bal Qty on a Cancelled
transfer. This is a disclosed judgment call, not a confirmed business rule from you - flag it if
Cancelled transfers should be excluded from this figure instead.

------------------------------------------------------------------------------------------------
PART 2 - Labour Master Partwise integrated into Material Transfer's "Labour" picker (web + mobile)
------------------------------------------------------------------------------------------------

BACKEND (shared by both web and mobile - one API, two clients):
- backend/JobCardScanner.Api/Models/MaterialTransferDocs.cs - new
  `enum MaterialTransferDocItemType { Part, Labour }` (defaults to Part - every existing row/
  caller keeps working unchanged) plus, on MaterialTransferDocItem: `ItemType` and a schema-only
  `TechnicianId`/`Technician` nav property (see Technician gap note below - never wired to a
  picker, always sent null).
- backend/JobCardScanner.Api/Data/JobCardScannerDbContext.cs - entity config extended:
  `ItemType` stored as a string (HasConversion<string>), `Technician` FK mapped.
- backend/JobCardScanner.Api/Program.cs - new self-healing schema block (this project has no EF
  migrations - see every earlier section) adding `ItemType NVARCHAR(20) NOT NULL DEFAULT ('Part')`
  and `TechnicianId UNIQUEIDENTIFIER NULL` + its FK to `dbo.MaterialTransferDocItems`, in its own
  try/catch so a fresh vs. already-deployed database both come up correctly.
- backend/JobCardScanner.Api/Dtos/Requests.cs - `CreateMaterialTransferItemRequest` gets two new
  optional trailing fields, `ItemType` (defaults to Part) and `TechnicianId` - old callers/payloads
  keep working unchanged.
- backend/JobCardScanner.Api/Controllers/MaterialTransferDocsController.cs:
    - `Create`: the PartUploads.BalQty decrement logic now skips any line whose ItemType is
      Labour (a Labour line never touches Part stock - see the model's own doc comment) and the
      new MaterialTransferDocItem row persists ItemType/TechnicianId.
    - `ForJob`/`ToRow`/`ToCombinedRow`: all three Items projections now include ItemType so the
      frontend (web's RepairBillCreatePage.tsx, and now mobile's RepairBillCreateScreen.tsx) can
      tell a synced Part line from a synced Labour line.
    - NEW `GET labour-by-part-code/{partCode}` - exact Part Code match against Labour Master
      Partwise (Active rows only), backs the "Labour" picker on both platforms.
    - NEW `GET labour-by-codes?codes=A,B,C` - batch, exact Labour Code match, added THIS round
      specifically so Repair Bill (web and mobile) can recover a synced Labour line's real
      IGST/CGST/SGST for its own CGST Amt/SGST Amt/IGST Amt columns, the same reason Part lines
      already do an equivalent by-code C_ItemMaster lookup (MaterialTransferDocItem itself stores
      NO tax columns at all - unchanged from every earlier section's own doc comment on that).
- backend/JobCardScanner.Api/Services/LabourMasterImportService.cs - two new read methods on
  ILabourMasterImportService: `GetPartwiseByPartCodeAsync` (already added earlier this round) and
  NEW `GetPartwiseByLabourCodesAsync` (batch, parameterized `IN (...)`, Active rows only) backing
  the two controller endpoints above.
- backend/JobCardScanner.Api/Controllers/LabourMasterController.cs - doc-comment-only change,
  recording WHY the new by-Part-Code lookup does NOT live on this controller (see Authorization
  finding below) - no behavior change to this file's existing actions.

IMPORTANT AUTHORIZATION FINDING (worth your attention even though it changed nothing you can see):
ASP.NET Core's `[Authorize]` attribute, when stacked at BOTH the controller class level and a
specific method, combines the two with AND semantics, not "the method-level one overrides the
class-level one." An initial draft of this feature put the new by-Part-Code Labour lookup on
LabourMasterController (class-level: WorkshopManagerUp) with a method-level
`[Authorize(ServiceAdvisorUp)]`, intending to widen access for a plain ServiceAdvisor doing
Material Transfer - that would NOT have worked; a ServiceAdvisor who isn't also WorkshopManagerUp
would still get a 403. Caught and corrected before shipping: the new endpoints instead live on
MaterialTransferDocsController, whose class-level policy is already ServiceAdvisorUp, so no
stacking is needed. Flagging separately: an EXISTING, pre-existing doc comment on
`PartUploadController.Get` makes a similar "method-level override" claim about itself - that
claim was NOT touched or verified (this app's `dotnet build` doesn't work in this sandbox, so it
was never runtime-testable), but it's very likely describing the same latent issue. Worth a real
look when you next have a build environment available, since it could mean that endpoint isn't
actually reachable by the role it's meant for.

WEB (web/src/pages/staff/MaterialTransferCreatePage.tsx, web/src/components/
PartwiseLabourModal.tsx - new file, web/src/pages/staff/RepairBillCreatePage.tsx,
web/src/types/index.ts):
- Each Part row in Material Transfer's own grid gets a new "Labour" button (enabled once an Item
  Code is picked) that opens PartwiseLabourModal - a popup scoped to that Part Code, modelled
  directly on the mt-labour_add.mp4 recording: search/pick a Labour Code, stage as many as needed,
  "Proceed" commits them.
- Picked Labour Codes land in a NEW, separate read-only-Item-Code sub-table below the main Part
  grid (Labour rows have no Item Code search/HSN/Rack/Bin/stock-cap concept of their own).
- "Issue Type ... that will goin for paid type ... also going in U/w" implemented as GOVERNANCE:
  changing a Part row's own Issue Type cascades to every Labour row added from it
  (updatePartIssueType) - the Labour sub-table shows Issue Type read-only so it can't silently
  drift from the Part line that governs it. Removing a Part row cascades to remove its Labour
  children too.
- These Labour rows flow into Repair Bill exactly the way Material-Transfer Part rows already did
  before this round: RepairBillCreatePage.tsx's existing materialTransferItems sync effect (which
  auto-loads its Part Details List from GET .../for-job/{jobCardId}) now branches on each synced
  row's ItemType instead of assuming every row is a Part - a synced Labour row lands in the
  existing Labour Details List table, read-only (no Edit, only Remove - Remove excludes it from
  THIS bill only, same "doesn't touch the underlying Material Transfer" semantics the existing
  Part-row Delete already has), tagged "via Material Transfer" so it's visually distinct from a
  manually-added Labour line.

MOBILE (mobile/src/screens/MaterialTransferCreateScreen.tsx,
mobile/src/components/PartwiseLabourModal.tsx - new file,
mobile/src/screens/RepairBillCreateScreen.tsx, mobile/src/types/index.ts):
- Material Transfer: mirrors web's flow adapted to this screen's own "add one line at a time,
  each line becomes a card" phone layout (not a grid) - once a Part line has been added, its card
  in the "Lines" list gets a "+ Labour" button opening the same PartwiseLabourModal (a bottom-
  sheet Modal here, mirroring this app's existing JobSearchModal pattern); picks are inserted as
  new Labour-type cards directly after their parent Part card, carrying that Part's Issue Type.
  Removing a Part card cascades to remove its Labour children.
- Repair Bill: IMPORTANT scope note - this screen had NO Material Transfer sync of ANY kind before
  this round (unlike web, which has always auto-loaded its Part Details List from Material
  Transfer). Bringing only Labour into Repair Bill on mobile, without also bringing the matching
  Part rows, would have left the screen showing Labour lines from a transfer whose own Part lines
  the user would still have to type in by hand - an inconsistent, confusing half-mirror of web's
  behaviour. So this round ports web's FULL sync effect to mobile (both Part AND Labour rows from
  Material Transfer, read-only, Remove-only exclusion, "via Material Transfer" tag) rather than
  only the new Labour half - this is a larger change on the mobile side than the web side for
  that reason, disclosed here rather than silently expanding scope without saying so.

NOT IMPLEMENTED, disclosed rather than silently dropped: the reference popup's own "Labour
Technician" dropdown (defaulting to the document's header Technician, independently changeable
per row). This is the SAME pre-existing, already-disclosed gap MaterialTransferCreatePage.tsx's
own doc comment already lives with - a ServiceAdvisor-level login has no accessible technician-
catalog endpoint to pick from (GET /api/users needs DealerAdminUp). The backend column
(MaterialTransferDocItem.TechnicianId) exists and is always sent as null on both platforms until
that gap gets its own real fix (a technician-lookup endpoint scoped to ServiceAdvisorUp).

VERIFICATION:
- Backend: hand-reviewed only - `dotnet build` still fails in this sandbox (NuGet restore to
  api.nuget.org gets a 403 from the sandbox's own egress proxy, unchanged from every earlier
  section). Please build/run this yourself before deploying.
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0, no errors, for every touched
  file (PartUploadPage.tsx, MaterialTransferCreatePage.tsx, RepairBillCreatePage.tsx,
  PartwiseLabourModal.tsx, types/index.ts). `npx oxlint` on the same files -> zero errors; one
  pre-existing warning class (react/set-state-in-effect) appears on PartwiseLabourModal.tsx's own
  fetch-on-mount effect, confirmed to be the SAME warning already present elsewhere in this
  codebase for the identical fetch-on-mount pattern (e.g. JobCardDetailPage.tsx) - not a defect
  introduced this round.
- Mobile: `cd mobile && npx tsc --noEmit -p tsconfig.json` -> exit 0, no errors, for every touched
  file (MaterialTransferCreateScreen.tsx, RepairBillCreateScreen.tsx, PartwiseLabourModal.tsx,
  types/index.ts). `npx oxlint` on the same files -> one PRE-EXISTING warning at
  RepairBillCreateScreen.tsx (an unused `d` parameter in an Insurance-panel date-picker callback
  several sections old, not part of this round's edits) - no new warnings introduced.
- Please confirm on your end, on both web and Android: (1) after picking a Part in Material
  Transfer, "Labour" opens the popup scoped to that Part Code and shows the same Labour Codes
  Labour Master Partwise has for it; (2) picking one or more and Proceeding adds them as their own
  Labour line(s), tagged to that Part; (3) changing the Part's Issue Type (web) updates its Labour
  children's Issue Type too; (4) saving the Material Transfer, then opening/creating a Repair Bill
  for the SAME Job, shows both the Part AND the Labour lines auto-loaded, with correct CGST/SGST/
  IGST amounts; (5) a Paid-issue-type Part's Labour ends up taxed normally on the Repair Bill,
  while a U/W one shows zero tax, matching the Issue Type it carried from Material Transfer.


================================================================================================
SECTION 75 - Material Transfer Bill: page restyled like Repair Bill, Job-linked field gating,
Labour Code search box, sidebar icon-click now expands the collapsed rail (WEB only)
================================================================================================

Your request (verbatim):
"in this page fix ui like repair bill and without Job No Job Search all feilds show disable and
which feilds are automatic fetch after job serach and select.. To / From (Party) that show
disablw we cant edit this only this code proper labour serach opended tab Add button fix"
...followed, mid-turn, by: "and also in sidebar menu when close and any icon click then this will
open that also add"

Scope note: both requests were about the WEB app only - you showed web screenshots, pasted web
source, and said "in this page" (no mobile screenshots or mention this round, unlike the earlier
Labour-in-Material-Transfer request which explicitly asked for "mobile and web both"). Nothing on
Android was touched this round.

INTERPRETATION flagged up front (Fact/Assumption/Interpretation discipline, since your instruction
was in broken English/Hinglish and admits more than one reading):
- "proper labour serach opended tab Add button fix" is read here as: replace the plain <select>
  Labour Code dropdown in the "Labour List" popup with a type-ahead SEARCH input (type a code or
  description, pick from a live-filtered dropdown), keeping the existing "+Add" (stage) button -
  modelled on this app's own established PartSearchInput.tsx combobox pattern, not invented fresh.
  This is an INTERPRETATION, not a confirmed instruction - the alternative reading ("Add button is
  functionally broken, fix that specific bug") was considered and set aside because nothing in the
  screenshots or your own testing note suggested the button wasn't working; the plain <select> was
  simply not a "search" as literally requested. Please flag it back if this isn't what you meant.

1. UI restyle to match Repair Bill (web/src/pages/staff/MaterialTransferCreatePage.tsx):
   The three logical sections of the create form now get the SAME bordered, colour-accented panel
   treatment RepairBillCreatePage.tsx already has (its own "attractive page" round) - reusing that
   page's own --primary/--accent-2/--accent-3/--warning/--border/--radius-sm design tokens from
   styles/global.css, nothing new invented:
   - "Job & Bill Details" (Job No/Location/Transfer Type/Party/Transfer Date/Remarks): --primary
     left border, 🧾 icon.
   - "Part Details List" (the main Item Code grid): --accent-3/--warning left border, 📦 icon.
   - "Labour" (the Labour Master Partwise sub-table): --accent-2 left border, 🔧 icon.
   Purely visual - no field, column, calculation, or save behaviour changed by this part.

2. Job-linked field gating ("without Job No Job Search all feilds show disable and which feilds
   are automatic fetch after job serach and select"):
   - Location, Transfer Type, Transfer Date, and Remarks are now `disabled` until a Job is linked
     (`disabled={!jobCardId}`) - Job No/Search Job itself is unaffected, it's the one live entry
     point. Once a Job is picked (selectJob, unchanged), these fields unlock; Location and Party
     continue to auto-fill from the job exactly as before.
   - To / From (Party) is a STRICTER case, per your explicit "that show disablw we cant edit this
     only this code": it is now ALWAYS disabled/read-only, Job-linked or not - it was never meant
     to be hand-typed, only auto-filled from the linked job's own Party Name.
   - Consequence handled: since Party can no longer be cleared by hand, unlinking a Job (the ✕ next
     to Job No) now also resets Party Name (to blank) and Location (back to the user's default/
     first workshop) - clearJob() was extended for this; previously it only reset the job link
     itself. Without this, unlinking a job would have left a permanently-stuck, unclearable Party
     value on screen once Party became always-disabled.

3. Labour Code search box (web/src/components/PartwiseLabourModal.tsx):
   The "Labour List" popup's Labour Code field is now a type-ahead search input instead of a plain
   <select> - type a code or part of the job description, pick a match from the live-filtered
   dropdown below the box, then "+Add" stages it exactly as before (unchanged staging/Proceed
   flow, unchanged backend call). No portal was needed here (unlike PartSearchInput.tsx's own
   dropdown, which sits inside the item grid's overflow-x-clipping scroll wrapper) - this modal's
   own card has no clipping ancestor, so a plain absolutely-positioned dropdown inside the field
   itself is enough.

4. Sidebar: icon click on the collapsed rail now expands it first (web/src/components/
   StaffLayout.tsx): previously, clicking a nav icon while the sidebar was collapsed (the 64px
   icon-only rail) navigated straight to that page without ever showing the full labeled menu -
   only clicking the sidebar's own background toggled it open. Now, the FIRST click on any nav
   icon while collapsed expands the sidebar (shows icon + label for every item) instead of
   navigating; a second click (now that it's expanded) navigates normally and the drawer
   auto-collapses back to the icon rail afterwards, same as before this change. This only touches
   the nav-link items in the `<nav>` list - the Logout link and the background-click toggle are
   unchanged.

NOT IMPLEMENTED / NOT CHANGED this round:
- Mobile (MaterialTransferCreateScreen.tsx, its own PartwiseLabourModal.tsx) - out of scope per
  your own wording this time ("in this page"), untouched.
- No new backend endpoints or schema changes - this is a frontend-only round.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0, no errors, across the whole
  app (not just the touched files - a full project check). `npx oxlint` on the three touched
  files (MaterialTransferCreatePage.tsx, PartwiseLabourModal.tsx, StaffLayout.tsx) -> zero new
  warnings/errors; the two `react/set-state-in-effect` warnings and the one
  `react/only-export-components` warning it reports are all on PRE-EXISTING code (the fetch-on-
  mount effect in PartwiseLabourModal.tsx, the sidebar's own close-on-navigate effect, and the
  already-exported NAV_ITEMS constant) - none introduced by this round's edits.
- Backend: N/A, no backend files touched this round.
- Please confirm on your end: (1) the Material Transfer Bill page now shows the three bordered/
  accented panels matching Repair Bill's look; (2) with no Job linked, Location/Transfer Type/
  Transfer Date/Remarks are all greyed out/disabled, and Party is disabled even WITH a Job linked;
  (3) picking a Job via Search Job fills Location and Party and unlocks the other four fields;
  (4) unlinking a Job (✕) clears Party back to blank and Location back to your default workshop;
  (5) the Labour List popup's Labour Code box now searches as you type instead of a dropdown list,
  and +Add still stages/removes/Proceeds correctly; (6) clicking any sidebar icon while the menu
  is collapsed (icons only) expands it to show labels, and clicking an icon again (now expanded)
  navigates to that page and the menu collapses back down.


================================================================================================
SECTION 76 - Material Transfer Bill: Part Details List grid also blocked until a Job is linked
(WEB only)
================================================================================================

Your request (verbatim): "without Job Search we cant add Part Details List tha also show block
sytematic wants"

Read as: extend SECTION 75's Job-linked disable gate (so far only on the header fields - Location/
Transfer Type/Transfer Date/Remarks/Party) to the Part Details List grid itself, the same
systematic way, so nothing in that section can be touched before a Job is searched and linked.

WEB (web/src/pages/staff/MaterialTransferCreatePage.tsx, web/src/components/PartSearchInput.tsx):
- Every control in a Part row is now `disabled={!jobCardId}`: both PartSearchInput boxes (Item
  Code, Description), Issue Type, Qty, Rate, Disc. Type, Discount Value, the row's own "Labour"
  button (which already required an Item Code - now ALSO requires a linked Job), and its Remove
  (✕) button.
- The "+ Add Line" button below the grid is disabled the same way, so a new Part row can't even be
  started before a Job is linked.
- PartSearchInput.tsx gained a new optional `disabled` prop (defaults to false/unset) to support
  this - it disables the underlying `<input>` and suppresses the dropdown while disabled.
  RepairBillCreatePage.tsx doesn't actually call this component (only mentions it in a doc
  comment), so it's unaffected either way.
- A one-line hint ("Search and link a Job above to add parts.") now shows inside the Part Details
  List panel header, but only while no Job is linked, so it's clear why the grid looks blocked.
- HSN Code stays as it always was (read-only/auto-filled regardless) - it was never an editable
  field to begin with, so it needed no change.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0. `npx oxlint` on
  MaterialTransferCreatePage.tsx, PartSearchInput.tsx, and RepairBillCreatePage.tsx (checked as
  the other file that references PartSearchInput, to confirm the new optional prop didn't regress
  it) -> zero errors or warnings on all three.
- Please confirm on your end: with no Job linked, every field/button in the Part Details List
  (Item Code, Description, Issue Type, Qty, Rate, Disc. Type, Discount, Labour, ✕, + Add Line) is
  greyed out and unclickable; picking a Job via Search Job unlocks all of them immediately.


================================================================================================
SECTION 77 - Material Transfer Bill bug fixes: stale Labour cleared on Item Code change, 0-qty
parts blocked from being added, dropdown ordered by stock (WEB only)
================================================================================================

Your request (verbatim): "now also 1 bug from Part Details List previously i added item code
which have labour link and i add labour but i chnaged my mind to change Item Code then still
shown labour when i change Item Code with that clear labour also cause for another Item Code have
another labour so fix this and which have 0 qty for Item Code that dont allow to add and in
dropdown show order which have qty this order show in dropdown this order show in dropdown ..fix
this and give me proper code"

Three fixes, all in the Part Details List grid:

1. BUG FIX - stale Labour not cleared on Item Code change (web/src/pages/staff/
   MaterialTransferCreatePage.tsx): a Part row's staged Labour rows (added via its "Labour"
   button, tracked by sourcePartKey) stayed attached even after the Item Code was changed to a
   completely different part - wrong, since Labour Master Partwise codes are looked up BY Part
   Code (see PartwiseLabourModal.tsx's own doc comment) and a different Item Code has a different
   (or no) matching set. Fixed at both places an Item Code can actually change:
   - Picking a new part from the dropdown (pickPartForLine): now cascade-clears any Labour rows
     with sourcePartKey === this row's key, but ONLY when the Item Code is actually different from
     what it was (re-picking the same part again, e.g. just to refresh its price, does NOT wipe
     Labour that still correctly applies) - new codeChanged check.
   - Typing directly into the Item Code box without picking from the dropdown (new
     changeItemCode() function, replacing the old plain `updateItem(key, { itemCode: text })` call
     on that one field): same cascade-clear, same "only when it actually changed" guard.
   - The "Labour" button on a Part row was already `disabled={!it.itemCode.trim()}` from an
     earlier round - untouched.

2. FIX - 0-quantity parts can no longer be added (web/src/components/PartSearchInput.tsx,
   web/src/pages/staff/MaterialTransferCreatePage.tsx): a new shared rule, isConfirmedOutOfStock
   (exported from PartSearchInput.tsx, imported into MaterialTransferCreatePage.tsx so the two
   never drift apart), blocks picking any Item Code with a CONFIRMED zero balance. "Confirmed"
   deliberately EXCLUDES source: 'itemMaster' rows - those carry a placeholder availableQty of 0
   only because no live DMS stock/Part Upload row has been loaded for that Item Code at the
   current Location yet (see BaplDmsPartStock's own doc comment: "not necessarily '0 in stock'") -
   blocking those too would have undone the earlier "take Item Code from /item-master ... we cant
   select" fix, which deliberately made every catalog item findable/pickable even with no stock
   data loaded. So a genuinely-zero live-DMS or Part-Upload row is blocked; an itemMaster-catalog-
   only row (unknown stock) is not. Enforced in TWO places: the dropdown row itself is greyed out,
   labelled "(out of stock)", and unclickable; and pickPartForLine (the function BOTH the Item
   Code and Description search boxes funnel through) refuses it a second time and shows a stock
   warning, in case anything ever calls it another way.
3. FIX - dropdown ordered by quantity (web/src/components/PartSearchInput.tsx): search results
   are now sorted with the highest available quantity first (`.sort((a, b) => b.availableQty -
   a.availableQty)`, a stable sort per the ES2019 spec, so same-quantity rows keep their prior
   relative order) instead of the previous unsorted (catalog-preload-then-stock-overlay) order -
   parts you can actually issue now surface at the top of the list; 0-balance/unknown-stock rows
   (both blocked or uncertain) sink to the bottom.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0. `npx oxlint` on
  MaterialTransferCreatePage.tsx and PartSearchInput.tsx -> ONE warning
  (react/only-export-components on PartSearchInput.tsx's new isConfirmedOutOfStock export) - the
  SAME warning class this codebase already has and tolerates for StaffLayout.tsx's own exported
  NAV_ITEMS constant (a component file sharing one non-component value with another page, so the
  single source of truth doesn't drift into two copies of the same rule) - not a defect, and no
  other warnings/errors.
- Please confirm on your end: (1) add a Part, pick Labour for it, then change that row's Item Code
  to a DIFFERENT part - its Labour rows disappear; (2) re-pick the SAME Item Code again (e.g. to
  refresh its price) - any Labour already staged for it stays; (3) searching an Item Code that has
  a real, confirmed 0 balance shows it greyed out/"(out of stock)" in the dropdown and clicking it
  does nothing, while an Item Master catalog-only entry (no stock data loaded) still picks
  normally; (4) the dropdown lists in-stock items before out-of-stock/unknown-stock ones.


================================================================================================
SECTION 78 - Repair Bill: Labour staging row fits on one line, page blocked without a Job (WEB
only)
================================================================================================

Your request (verbatim): "in repair bill Labour part line fix this in 1 line
Labour,Description,Qty,Rate,Disc. Type,Discount,Issue Type, Add button in 1 line and in this
repair bill also block all withour job search"

Two fixes, both in web/src/pages/staff/RepairBillCreatePage.tsx (plus the two search-input
components it uses):

1. Labour staging row now actually fits on one line (web/src/pages/staff/
   RepairBillCreatePage.tsx): an EARLIER round already tried to fix this same "fields wrapping
   onto two rows" problem by switching the row to `.suggest-row`/`.field-grow`/`.field-compact`,
   but it wasn't enough on its own - `.field-grow` (`flex: 1 1 260px`) was still applied to the
   Labour and Description fields, and kept claiming far more width than their own boxes actually
   need (they already carry a fixed pixel width via LabourSearchInput's own `width` prop), leaving
   too little room for Qty/Rate/Disc. Type/Discount/Issue Type/+Add to stay on the same line -
   exactly the two-row wrap you saw in your screenshot. Fixed by switching Labour/Description to
   `field-compact` too (the same class every other field in this row already used), so all seven
   fields plus the Add/Update button now size to their own content and read as one line.
   `.suggest-row`/`.field-grow`/`.field-compact` themselves were NOT touched in styles/global.css,
   so JobCardDetailPage.tsx's own "Suggest a part"/"Suggest labour" rows (which still want their
   one search field to grow) are unaffected.

2. Everything blocked until a Job is linked ("also block all withour job search") - same
   Job-linked gate as Material Transfer Bill's own SECTION 75/76, extended here:
   - Bill Type, Bill Date, and Remarks are now `disabled={!jobCardId}`.
   - The whole Labour staging row (Labour search, Description search, Qty, Rate, Disc. Type,
     Discount, Issue Type, +Add/Update) is disabled the same way - LabourSearchInput.tsx gained a
     new optional `disabled` prop for this (same shape as PartSearchInput.tsx's own, added last
     round for Material Transfer Bill).
   - Edit/Delete/Remove on an existing Labour Details List row are also disabled without a linked
     Job (Part Details List rows needed no separate change - they only ever exist once a Job is
     linked in the first place, since they auto-load from that Job's own Material Transfer data).
   - The "Save as Proforma" button is disabled without a linked Job too.
   - Two hint lines were added ("Search and link a Job above to fill in the rest of this bill." /
     "...to add Labour.") so it's clear why the page looks blocked.

   IMPORTANT CONSEQUENCE - please read before merging: Party Name, Reg No, Chassis No, and
   Location had a DELIBERATE, pre-existing rule on this page (added 2026-09-22, "Party Name, Reg
   No, Chassis No, Location that also auto fetched feild that also dont show editable"): they were
   editable BY HAND specifically when NO Job was linked (a standalone/walk-in bill), and became
   read-only only once a Job auto-filled them. Literally applying "block all without job search"
   to this page REVERSES that - these four fields are now locked in BOTH states (auto-filled and
   read-only when a Job is linked, same as before; simply BLOCKED, not handed back for manual
   entry, once it's unlinked). The practical effect: a Repair Bill can no longer be created without
   first linking a Job Card - the standalone/walk-in bill path this page used to support is gone.
   This is a genuine business-rule change, not just a UI tweak, and it was applied because your
   instruction read as wanting full parity with Material Transfer Bill's own all-fields-need-a-Job
   gate - please confirm this is actually what you want; if a walk-in/no-job Repair Bill still
   needs to exist, tell me and I'll narrow this back down to just the Labour row + Bill Type/Date/
   Remarks/Save button, leaving Party Name/Reg No/Chassis No/Location's original "editable only
   when no Job" rule alone. clearJob() was extended to reset these four fields to blank/default on
   unlink, since there's no other way left to clear them now that they can't be hand-edited.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0. `npx oxlint` on
  RepairBillCreatePage.tsx and LabourSearchInput.tsx -> zero errors or warnings.
- Please confirm on your end: (1) the Labour staging row (Labour/Description/Qty/Rate/Disc.
  Type/Discount/Issue Type/+Add) now sits on a single line without wrapping; (2) with no Job
  linked, every field on the page (Party Name, Reg No, Chassis No, Location, Bill Type, Bill Date,
  Remarks, the whole Labour row, Save as Proforma) is disabled/blocked, and existing Labour rows'
  Edit/Delete/Remove icons are disabled too; (3) linking a Job via Search Job unlocks Bill Type/
  Bill Date/Remarks/the Labour row/Save, and fills Party Name/Reg No/Chassis No/Location (still
  read-only); (4) unlinking a Job clears Party Name/Reg No/Chassis No back to blank and Location
  back to your default workshop, and re-locks everything; (5) re-read the IMPORTANT CONSEQUENCE
  note above and tell me if the no-job/walk-in bill path needs to come back.


================================================================================================
SECTION 79 - Material Transfer Bill: Labour hidden from this page (still saves + still flows into
Repair Bill), auto-linked via Category with no popup, Issue Type auto-fills from Category (WEB
only)
================================================================================================

Your request (verbatim): "in material transfer in that which we added Labour (Labour Master
Partwise, added via each Part row's "Labour" button) that hide in page that only save in backend
when i repair bill open in that tht will shown and ui wants to change

1. when i search Item Code and select then auto fetch all details in that also add dependency
with item code which i select Issue Type then automatically Paid that Part Code(Item Code)
regarding Category match Paid or U/W and in row of Part Details List Labour button have on the
place ADd button add and dont open pop up tab direct that item code and Issue Type regarding
which labour linked that link with that item code dont show on ui hide this and + Add Line this
button also add in each details which fill when we click on + Add Line button then this button
shifted on next line which we + Add Line and cancle then shift on previous that proper code give
me and which labour added in material transfer page that show when im going in repair bill page
with this job card ..and repair bill which i attached screenshot that will add and this grid
button click from db which material transfer that will shown for Save as proporma and save as
invoice"

This was several requests bundled into one message, in broken English/Hinglish - broken out below
item by item, with what was actually implemented vs. what's flagged as unclear rather than
guessed at (Fact/Interpretation discipline, per org policy on not inventing business rules).

IMPLEMENTED (web/src/pages/staff/MaterialTransferCreatePage.tsx only):

1. The "Labour (Labour Master Partwise, added via each Part row's 'Labour' button)" table is
   REMOVED from this page's own UI. Staged Labour rows still exist in this page's own `items`
   state and still save to the backend exactly as before (the save() payload already iterated
   over the full `items` array regardless of what was rendered - nothing there changed) - they're
   simply no longer shown on THIS screen. They still surface once you open Repair Bill for the
   same Job (RepairBillCreatePage.tsx's own materialTransferItems sync effect - unchanged, not
   touched this round, see FACT note below).

2. NEW dependency: picking an Item Code now ALSO fetches that Part Code's Labour Master Partwise
   rows (GET /api/material-transfer-docs/labour-by-part-code/{itemCode}, the same endpoint the old
   popup used) and auto-sets the Part row's Issue Type from their Category field - "paid" maps to
   Issue Type "Paid", "u/w"/"uw"/"warranty" maps to "U/W". INTERPRETATION/ASSUMPTION, flagged: a
   Part Code's Labour Master Partwise rows are assumed to all share one Category (the screenshot
   you showed had one Category per Part Code) - the FIRST matching row's Category is used as
   authoritative. Only overwrites Issue Type when a Category is actually found and maps cleanly -
   never clears an existing value back to blank on a miss, so a hand-picked Issue Type on a part
   with no Labour Master Partwise match is left alone.

3. The "Labour" button on a Part row is now "+ Add" and no longer opens a popup - INTERPRETATION,
   flagged, a real behaviour change: one click fetches every Labour Master Partwise row for that
   Part Code and stages ALL of them silently (skipping any already staged for that row) - there is
   no more per-row pick/stage/Proceed dialog. A one-line confirmation ("✓ Added N Labour code(s)
   for <code>.") or a "none found"/"already added" message shows briefly below the grid - this is
   the only on-screen feedback left for the click, not a persistent table (kept deliberately
   minimal so it doesn't reintroduce what item 1 asked to hide). If a Part Code genuinely has more
   than one Labour Code that should NOT always be added together, this over-adds - tell me and I'll
   bring back a choice (not the old popup, something lighter).

   PartwiseLabourModal.tsx (web) is now UNUSED by this page as a result - not deleted (kept in case
   this needs reverting), and still used as-is by mobile's own MaterialTransferCreateScreen.tsx
   (mobile untouched this round, per your own "in this page" scoping on earlier rounds - no mobile
   changes were made here either).

CONFIRMED AS ALREADY WORKING, NOT NEW - FACT, not something built this round: "which labour added
in material transfer page that show when im going in repair bill page with this job card" -
RepairBillCreatePage.tsx's own materialTransferItems sync effect (added in an earlier round, not
touched this round) already pulls in BOTH Part and Labour rows from GET
/api/material-transfer-docs/for-job/{jobCardId} and branches on itemType - a Labour row saved via
Material Transfer already appears in Repair Bill's own Labour Details List for the same Job,
tagged "via Material Transfer". If you're seeing this NOT happen in practice, that's a bug report,
not a feature request - please say so specifically (with a screenshot of the Repair Bill page for
that same Job) and I'll dig into it directly rather than re-describing already-existing code.

NOT IMPLEMENTED - genuinely unclear, flagged rather than guessed at:

- "+ Add Line this button also add in each details which fill when we click on + Add Line button
  then this button shifted on next line which we + Add Line and cancle then shift on previous" -
  I could not confidently work out what change (if any) is being asked for here. My best reading
  is that this may already be the existing behaviour: the single "+ Add Line" button already sits
  directly below the last row and naturally moves down/up as rows are added/removed (it's a plain
  block-flow element after the table, not fixed-positioned) - if that's what you meant, nothing
  needs to change. If you're seeing an actual glitch (the button jumping somewhere unexpected, not
  repositioning, etc.), a screenshot or short screen recording of the specific behaviour would let
  me fix the right thing instead of guessing at a UI restructuring (e.g. a separate Add button per
  row) that may not be wanted.
- "repair bill which i attached screenshot that will add and this grid button click from db which
  material transfer that will shown for Save as proporma and save as invoice" - also unclear what
  specific action or bug this refers to. If this is about the Save as Proforma / Save as Invoice
  buttons not correctly showing Material-Transfer-sourced Part/Labour data in some case, please
  describe the exact steps (or point to which button in the screenshot) and I'll look at it
  directly.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0. `npx oxlint` on
  MaterialTransferCreatePage.tsx -> zero errors or warnings.
- Please confirm on your end: (1) picking an Item Code with a Labour Master Partwise match now
  auto-sets that row's Issue Type; (2) the "+ Add" button on a Part row adds Labour silently (no
  popup) and shows a one-line confirmation, without any Labour table appearing on this page; (3)
  the Material Transfer still saves correctly (check the saved record's detail view, or open
  Repair Bill for the same Job, to confirm the Labour rows really did save even though they're not
  shown here); (4) clarify the two NOT IMPLEMENTED items above so I can act on them precisely.

================================================================================
SECTION 80 (2026-09-23)
================================================================================
USER REQUEST (video attached, "RB-Grid button.mp4"): follow-up to SECTION 79's item 6, which had
been left unimplemented as "too unclear". Verbatim: "Repair bill which i attached screenshot that
will add and this grid button click from db which material transfer that will shown for Save as
proporma and save as invoice ... i will showing u video this button clcik shown all details which
material transfer for which job card that button add"

WHAT THE VIDEO SHOWED: screen recording of the REFERENCE BAPL DMS web app (bapldmssite-...
.azurewebsites.net/repair-bill-list and /repair-bill/85) - not JobCardScanner. It shows: opening
the Repair Bill List, clicking an existing bill row (Bill No 22), which reopens as the SAME
editable Repair Bill form used to create a bill - Date/Location/Bill No/Party Name/Job Search
header, a "Selected Job Details" panel (Job Date/Job No/Reg No/Model/KMs/Chassis/Technician),
Labour/Part staging rows, a Labour Details List/Part Details List, and "Save As Invoice"/"Close"
buttons right there on that same page - not a separate read-only view.

CLARIFYING QUESTION (asked via the app's built-in question tool, since this was a real fork
affecting how much to build, not something to guess at): confirmed that JobCardScanner's Repair
Bill page ALREADY auto-loads Material Transfer Parts/Labour into the grid the moment a Job is
linked (this is SECTION 78/79-era existing behaviour, unchanged) and ALREADY has the same
Proforma -> Invoice two-step lifecycle (Save as Proforma on create; Save as Invoice as a later
step). The one real gap: clicking an existing bill in JobCardScanner's own list opened only a
READ-ONLY popup, with no way to reopen it as an editable grid the way the reference video shows.
You confirmed: build the reopen-as-editable-form flow.

IMPLEMENTED (Repair Bill page only - web; no change to Material Transfer or mobile):

1. Backend (Controllers/RepairBillDocsController.cs):
   - New `PUT /api/repair-bill-docs/{id}` - updates an EXISTING bill's header fields and fully
     replaces its Items, using the exact same tax/discount/Extended-Battery-Warranty/Part-Upload-
     stock calculation Create already used (extracted into a new shared private method,
     BuildAndAttachItemsAsync, so Create and this new Update call identical logic - nothing about
     how tax or stock is computed changed). Only allowed while the bill's Status is still
     "Performa" - a Billed or Cancelled bill returns 400 rather than silently letting a finalized
     bill's totals change. Part Upload stock (PartUploads.BalQty) is restored for the bill's OLD
     items first, then decremented again for the NEW items, so editing a Part's Qty (or
     adding/removing a Part line) nets out correctly instead of double-counting.
   - `GET /api/repair-bill-docs/{id}` now also returns JobCardId and JobCardNumber (via a new
     Include(r => r.JobCard)) and Remarks (previously saved but never actually returned by this
     endpoint - a pre-existing small gap, now fixed so reopening a bill for editing doesn't
     silently wipe out its Remarks on save).

2. Web (RepairBillCreatePage.tsx):
   - Clicking a JobCardScanner-own bill row that's still "Performa" in the list now reopens the
     SAME "New Repair Bill" form, pre-filled (startEditBill) - Job re-linked (so the "Selected Job
     Details" panel and Labour search still work), Bill Type/Bill Date/Remarks/insurance
     fields/Total Discount/Amount Received restored from the bill, and the card's own heading
     changes to "Editing Bill <No> [status]" with a "Cancel edit / start a new bill" button. A
     DMSBAPLDATA-synced row, or a JobCardScanner bill that's already Billed/Cancelled, still opens
     the old read-only popup (nothing to edit on either of those).
   - Part lines are DELIBERATELY re-derived FRESH from the Job's CURRENT Material Transfer (same
     as a brand-new bill) rather than replayed from what the bill happened to save previously -
     this is the literal "pull from Material Transfer in the DB" behaviour the video showed, and
     avoids showing stale data if more was transferred since the bill was first saved. Only Labour
     lines are restored from the bill's own saved items (a Labour line can also be hand-added,
     independent of Material Transfer) - restored as editable rows, then deduplicated once the
     fresh Material Transfer data loads, so a Labour line that WAS Material-Transfer-sourced
     doesn't show twice.
   - ASSUMPTION, disclosed in code comments: a Part/Labour line's own saved Discount/Issue Type is
     only a BEST-EFFORT restoration (matched by item code, since a saved line has no direct link
     back to the Material Transfer row it came from) - if two different lines on the same bill
     ever shared an item code with different discounts, only one would be recovered correctly.
     Flagging this rather than promising a guarantee I can't back.
   - The Save button becomes "Update Proforma" while editing (calls the new PUT instead of POST,
     and does NOT clear the form afterwards - unlike a fresh save, so you can immediately follow
     up with Save as Invoice). A "Save as Invoice" button now also sits right next to it whenever
     the bill being edited is still Performa - same finalization endpoint the read-only popup's
     own button already called, just also reachable from here now.
   - Pre-2026-09-23 bills saved with no Job linked at all still open (fields visible/reviewable),
     but can no longer be saved further (Save stays disabled without a Job, same restriction every
     bill on this page has had since the earlier "block all without job search" change).

NOT RE-TOUCHED: Material Transfer Bill page, mobile app, and everything else covered by SECTIONS
1-79 stay exactly as they were.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0 (twice, after each batch of
  edits). `npx oxlint` on RepairBillCreatePage.tsx and types/index.ts -> zero errors or warnings.
- Backend: hand-reviewed only (no dotnet build available in this sandbox - NuGet restore fails
  with 403 through the sandbox's own egress proxy, unrelated to your network). Checked brace
  balance and that every new/changed line references only fields and DbSets that already exist
  elsewhere in this same file. Please build/run this controller on your end before relying on it.
- Please confirm on your end: (1) creating a fresh bill still works exactly as before (Save as
  Proforma, then Save as Invoice from the list); (2) clicking an existing Proforma bill reopens it
  editable, with Job/Labour/Part data populated correctly; (3) editing and re-saving (Update
  Proforma) doesn't lose the bill's Remarks/insurance fields; (4) Update Proforma correctly
  rejects if you try it on a bill that's already Billed (shouldn't be possible via the UI now,
  since editing only ever opens for a Performa bill, but worth confirming the backend guard too);
  (5) Part Upload stock nets out correctly if you edit a bill's Part quantities (compare Parts
  Inward/Part Upload balance before and after an edit).

SECTION 81 (2026-09-23)
================================================================================
USER REQUEST (verbatim, follow-up to SECTION 80): "this button not added why? please add and
there history maintain in which job card which item material transfered and there we can add
labour"

INTERPRETATION: the reopen-as-editable flow just built for Repair Bill (SECTION 80) had not yet
been built for Material Transfer Bill - this section is that same capability's Material Transfer
sibling, plus two things explicitly named in this request: (a) "history ... which job card" - a
Job No column on the Material Transfer combined list so it's visible per row which Job Card each
transfer belongs to; (b) "we can add labour" - confirming the existing per-Part-row "+ Add"
button (SECTION 79-era) still works once a transfer is reopened for editing (it does, unchanged -
it just operates on the same `items` state either way).

IMPORTANT ARCHITECTURAL DIFFERENCE FROM SECTION 80, called out rather than blindly copied:
Repair Bill's Part lines re-derive FRESH from the Job's current Material Transfer on reopen (only
Labour is restored from the bill's own saved rows) - Material Transfer is a separate, still-live
upstream source for Repair Bill to pull from. Material Transfer has no such separate upstream
source for ITS OWN Part lines - a Material Transfer document IS the record being edited. So this
section's reopen restores EVERY saved line (Part and Labour alike) directly from the transfer's
own saved Items, not just Labour.

BACKEND (Controllers/MaterialTransferDocsController.cs):
- List()/Combined()/Get(): added `.Include(m => m.JobCard)` (same change RepairBillDocsController
  made in SECTION 80, for the same reason - JobCardNumber needed on the row/detail response).
- New `PUT /api/material-transfer-docs/{id}` Update(): the Material Transfer sibling of
  RepairBillDocsController.Update. Guards: Items required; transfer must exist; Status must still
  be Draft (Confirmed/Cancelled -> 400, no "undo" here); a non-SystemAdmin is blocked if the same
  Job's own Repair Bill has already been Billed (re-uses Delete's exact existing check, rather
  than inventing a looser rule for Update alone - editing what was transferred after the
  resulting bill is finalized would silently make what's billed and what's on hand disagree).
  Restores the OLD items' PartUploads.BalQty impact first (same restore Delete already performs),
  THEN re-decrements for the NEW items via the shared ApplyStockAndBuildItemsAsync - so editing a
  Part line's Qty (or adding/removing one) nets out correctly instead of double-counting.
- Create() refactored: item-build/stock logic extracted into the new shared
  ApplyStockAndBuildItemsAsync(doc, req, dealerId), called by both Create and Update - so the two
  paths can never drift apart the way Repair Bill's own Create/Update do (see SECTION 80).
- ToRow(): now also returns JobCardId/JobCardNumber/Remarks (previously not returned at all - a
  reopened edit form needs these to re-link the same Job and not silently drop Remarks on save).
- ToCombinedRow(): now also returns JobNo (from the new JobCard include) - the "history ... which
  job card" column.
- Dtos/Requests.cs: CombinedMaterialTransferRow extended with `string? JobNo = null`.
- Verified: brace-balanced (72 open / 72 close via a python script), hand-reviewed only - no
  dotnet build available in this sandbox (NuGet restore fails with 403 through the sandbox's own
  egress proxy - a known, standing limitation, not new this round).

WEB (web/src/pages/staff/MaterialTransferCreatePage.tsx):
- New state: editingTransferId/editingTransferNumber/editingTransferStatus/editLoadError/
  convertingId - mirrors RepairBillCreatePage.tsx's own editingBillId/editingBillNumber/
  editingBillStatus/editLoadError/convertingId from SECTION 80.
- New resetFormToNew(): factored out of save()'s old POST-success handler, reused by cancelEdit.
- New startEditTransfer(row): GETs the full transfer, restores header fields (Transfer Type/
  Party/Remarks/Transfer Date/Location), and restores EVERY saved item (Part and Labour) directly
  onto `items` - see the architectural-difference note above for why this differs from Repair
  Bill's Parts-re-derive/Labour-only-restore split. Two disclosed ASSUMPTIONS on the restored
  lines, both flagged in code comments since nothing is silently guessed:
    (1) GST%/CGST/SGST/IGST are never persisted on MaterialTransferDocItem (confirmed on that
        model's own doc comment - display-only, computed live from C_ItemMaster at pick time), so
        a restored line has nothing saved to read them back from - reset to the same 9/9/18
        fallback emptyItem() already uses. Does not affect the saved Rate/Amount, only the CGST
        Amt/SGST Amt/IGST Amt DISPLAY columns on this form.
    (2) discountType/discountValue reset to '%'/'0' on restore (no re-discount stacked on top) -
        a saved line's own Rate already has any prior discount baked in (see lineCalc's own doc
        comment), so this avoids silently double-discounting.
  A third best-effort/ASSUMPTION: sourcePartKey (which Part row a Labour row's Issue Type is
  governed by) has no persisted relationship on MaterialTransferDocItem either - rebuilt via
  "nearest preceding Part row in the saved item order" (items are always originally saved in that
  order, since a Labour row is appended immediately after its parent Part row via
  autoAddLabourForPart) - flagged as an assumption that would need revisiting if line reordering
  is ever added, though it only affects the Issue-Type-cascade/cascade-delete convenience, never
  what's actually saved.
- If the linked Job re-fetch (for Party State / tax-mode detection) fails, it's caught silently -
  same non-fatal pattern RepairBillCreatePage.tsx's own startEditBill already uses.
- save() now branches PUT (editingTransferId set) vs POST, mirroring RepairBillCreatePage.tsx's
  own save(). PUT does NOT reset the form on success (so Confirm Transfer can immediately follow);
  POST still resets to a blank form via resetFormToNew(), same as before this round.
- New finalizeEditingTransferAsConfirmed(): reuses the existing PUT .../status endpoint (already
  used elsewhere for Draft->Confirmed/Cancelled), the Material Transfer sibling of Repair Bill's
  own finalizeEditingBillAsInvoice.
- JSX: card header conditionally shows "Editing Transfer {no} [status badge]" + a Cancel button,
  vs "New Material Transfer"; editLoadError rendered below; Save button label becomes "Update
  Draft" when editing (disabled once the transfer is Confirmed/Cancelled), with a "Confirm
  Transfer" button next to it while still Draft, and a message when the transfer is already
  finalized - same layout pattern as Repair Bill's own Save-as-Proforma/Save-as-Invoice pairing.
- Combined list table: new "Job No" column (CombinedMaterialTransferRow.jobNo, already wired
  through by the backend change above) - the explicit "history maintain in which job card" ask.
  Row onClick now branches: a still-Draft JobCardScanner-own row opens editable (startEditTransfer)
  instead of always opening the existing read-only popup; a Confirmed/Cancelled/DMSBAPLDATA row
  still opens that same read-only popup as before. colSpan on the "no rows" placeholder bumped
  10 -> 11 for the new column.

NOT CHANGED: the existing read-only popup (RecordDetailModal) for a Confirmed/Cancelled/
DMSBAPLDATA row; the "+ Add" Labour button and its own logic (SECTION 79); Repair Bill's own
SECTION 80 reopen flow; mobile app; everything else.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0. `npx oxlint` -> zero warnings
  or errors on MaterialTransferCreatePage.tsx (confirmed via `grep -i MaterialTransferCreatePage`
  on the full oxlint output - no matches; all warnings printed belong to other, untouched files).
- Backend: hand-reviewed only (same dotnet-build limitation noted above). Checked brace balance
  and that every new/changed line references only fields/DbSets that already exist elsewhere in
  this same file (ApplyStockAndBuildItemsAsync, the Delete-mirrored billed-job guard, the
  PartUploads restore-then-redecrement pattern).
- Please confirm on your end: (1) creating a fresh transfer still works exactly as before; (2)
  clicking an existing Draft transfer (JobCardScanner-own) reopens it editable, with Job/Part/
  Labour lines populated; (3) editing and re-saving (Update Draft) doesn't lose Remarks, and nets
  out Part Upload stock correctly if you change a Part line's Qty (compare Part Upload balance
  before/after); (4) Confirm Transfer correctly locks the transfer from further edits, and Update
  Draft correctly refuses on a transfer that's no longer Draft; (5) the new Job No column shows
  the right Job Card for a handful of existing transfers; (6) the "+ Add" Labour button still
  works normally on a reopened transfer, and a re-added/edited Labour line still flows into Repair
  Bill for the same Job afterwards (unchanged sync effect on that page).

SECTION 82 (2026-09-23)
================================================================================
USER REQUEST (verbatim, 2 screenshots attached of the Repair Bill create form's Job & Bill
Details panel): "add grid button and in that that job card shown which will transfer from
material transfer to save as proforma using adding labour details add this only this page give me
for android and web adding this button and in that fix header in all pages like in my table have
100 records but when i scroll then with header that will scroll so for all pages that fix and me
all"

INTERPRETATION (two separate asks in one message, flagged since the wording is broken English/
Hinglish and each is a real, distinct change):
  1. "add grid button ... which will transfer from material transfer to save as proforma using
     adding labour details ... give me for android and web" - the SECTION 80 reopen-as-editable
     flow (click a saved Repair Bill, it reopens as the same form pre-filled with Job/Material
     Transfer/Labour data, ready for Save as Proforma/Save as Invoice) already exists on WEB but
     had NO Android equivalent at all - this section builds that Android equivalent, and ALSO adds
     an explicit "grid button" (a literal button, not just a row click) on both platforms.
     "add this only this page" is read as: this capability is scoped to the Repair Bill page only
     (matching both screenshots, which are of that page) - Material Transfer's own Android reopen-
     as-editable flow (the mobile sibling of SECTION 81) is NOT included here; ask if you want that
     too.
  2. "fix header in all pages ... table have 100 records but when i scroll then with header that
     will scroll" - every table's own column-header row (<thead>) scrolling away with the page on
     a long list, instead of staying visible - a GLOBAL, app-wide CSS fix (web only - "my table" in
     the screenshots is clearly the web app; there is no comparable HTML-table concept on Android,
     which already keeps the header form fields and list rows in one continuous ScrollView with no
     separate scrolling grid).

PART 1a - WEB (web/src/pages/staff/RepairBillCreatePage.tsx): explicit Edit button
  - The combined list's Bill row already opens editable on a click anywhere on the row (SECTION
    80, unchanged) - a "✎" icon button now ALSO sits in the row's own action column (next to
    Delete) for the same JobCardScanner-own, still-Performa row, so the capability is directly
    visible as a literal button, not only discoverable by clicking the row itself.
  - That action column header/cell is no longer gated on `canDelete` (a SystemAdmin-only flag) -
    it's now always rendered, since the Edit button should be visible to every user who can reach
    this page (row-click already grants everyone the same capability today), while Delete inside
    it stays exactly as gated as before (SystemAdmin only).
  - "no rows" placeholder colSpan simplified from `canDelete ? 14 : 13` to a flat 14 to match.

PART 1b - ANDROID (mobile/src/screens/RepairBillCreateScreen.tsx + mobile/src/types/index.ts):
new reopen-as-editable flow, the Android port of SECTION 80/81's web-side flow
  - mobile/src/types/index.ts: added RepairBillDocItem/RepairBillDoc interfaces (the full GET
    /api/repair-bill-docs/{id} response shape) - mirrors web/src/types/index.ts's own copies
    exactly; these didn't exist on mobile before (only RepairBillDocItemType/RepairBillDocStatus/
    the flatter CombinedRepairBillRow did).
  - New state: editingBillId/editingBillNumber/editingBillStatus/editLoadError/convertingId, plus
    editSnapshotByCodeRef/dedupeLabourAfterEditRef/scrollRef - direct ports of web's own
    equivalents (see RepairBillCreatePage.tsx's own doc comment for the original reasoning).
  - New resetFormToNew()/startEditBill(row)/cancelEdit()/finalizeEditingBillAsInvoice() - same
    shape and same Part-vs-Labour restoration asymmetry as web's SECTION 80: Part lines are
    DELIBERATELY NOT restored from the bill's own saved items - they re-derive fresh from the
    Job's CURRENT Material Transfer via this screen's own existing sync effect (unchanged,
    2026-09-22-era). Only Labour lines are restored (as manual "edit-N" rows, a new key prefix
    distinct from "manual-N" and from a real Material Transfer GUID), then deduplicated once the
    fresh Material Transfer fetch resolves via a new one-time effect, so a Labour line that WAS
    Material-Transfer-sourced doesn't show twice.
  - A line's own saved Discount/Issue Type is best-effort restored (matched by item type + code,
    since a saved bill line has no direct FK back to the Material Transfer row it came from) via
    editSnapshotByCodeRef, applied inside the existing materialTransferItems sync effect - same
    disclosed best-effort limitation as web (two lines sharing a code with different discounts
    would only recover one correctly).
  - save() now branches PUT (editingBillId set) vs POST, mirroring web. PUT does NOT reset the
    form (so Save as Invoice can immediately follow); POST still resets via resetFormToNew().
  - UI: since this screen has NO separate list page (form + combined list are one continuous
    ScrollView, tap-to-expand already existed for a row's summary), the "grid button" ask is
    implemented as an explicit "✎ Edit this Bill" button INSIDE a tapped row's expanded detail
    (only for a JobCardScanner-own, still-Performa row) - tap-to-expand itself is unchanged, this
    is a new, additional button, not a repurposing of the existing gesture. The header above the
    form shows "Editing Bill {no} [status]" + a Cancel button while editing, same pattern as web;
    Save becomes "Update Proforma" (disabled once Billed/Cancelled), with "Save as Invoice" next
    to it while still Performa.

NOT CHANGED: Material Transfer's own Android screen (no reopen-as-editable added there this
round - see the "add this only this page" interpretation above); RepairBillDocsController.cs/
MaterialTransferDocsController.cs (no backend change needed - both PUT endpoints already exist
from SECTION 80/81 and this section's mobile screen calls the same one web already uses).

PART 2 - WEB GLOBAL STICKY TABLE HEADER (web/src/styles/global.css):
  - One CSS rule added: `thead th { position: sticky; top: 0; background: var(--surface);
    z-index: 5; }`, plus `@media print { thead th { position: static; } }` so it doesn't affect
    a printed page.
  - Applied via a plain element selector, not a class - takes effect on EVERY table on every page
    (confirmed via a `<table` grep across the web app - 26 files: Job Cards list, Parts, Repair
    Bill, Material Transfer, Item Master, Labour Master, Part Upload, and every other grid) with
    NO per-page markup change needed, and covers every future table too.
  - `top: 0` (not a topbar-height offset) is correct: .topbar is NOT position:fixed in this app's
    CSS, so it scrolls away with the rest of the page content too - by the time a sticky header
    needs to "stick" the topbar has already scrolled clear of it.
  - An explicit solid background stops table body rows from visibly showing/bleeding through
    behind the header as they scroll underneath it (browsers give <th> no opaque background by
    default). z-index kept low (5), well under the sidebar (110) and the profile dropdown (40).
  - Not something I could screenshot-verify myself in this sandbox (no way to open the running
    web app here) - please confirm on your end with an actual 100+-row table (Job Cards list is
    probably the easiest to check) that the column-label row now stays visible while you scroll
    through the data rows, on both light and any custom theming this app has.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0. `npx oxlint` -> zero warnings
  or errors on RepairBillCreatePage.tsx or global.css (confirmed via grep on the full oxlint
  output - no matches for either file).
- Android: `cd mobile && npx tsc --noEmit -p tsconfig.json` -> exit 0, WHOLE PROJECT (no separate
  lint config exists on this mobile project - tsc is the only automated check available here,
  same as every prior Android round in this changeset).
- Backend: NOT TOUCHED this round - both endpoints this screen calls (PUT /api/repair-bill-docs/
  {id} and PUT .../status) already existed from SECTION 80, already hand-reviewed there.
- Please confirm on your end: (1) on Android, tapping an existing Performa bill's row, then its
  new "Edit this Bill" button, reopens it with Job/Party/Insurance/Discount fields and Labour
  lines populated correctly, and Part lines re-appear from the linked Job's current Material
  Transfer; (2) Update Proforma and Save as Invoice both work from that reopened Android form;
  (3) on web, the new "✎" button in the Repair Bill list behaves identically to clicking the row
  itself; (4) the sticky table header looks right (correct background, no visual overlap with the
  topbar or with dropdowns/modals) on a few different pages, especially any page with a genuinely
  long table.

================================================================================================
SECTION 83 - 2026-09-23 - "in 1 line row this Labour1 ..Issue Type and button add in 1 line and
when i click from repair bill previous saved details then this will shown in same page new under
new page maintaing this details and Source SR.No Bill No Date Party Name Reg No Chassis No
Location Bill Type Job No Bill Amount Status Prepared by Modified by this main in 1 page not on
same only which are save in jobcard db that in grid button and which material transfer that
jobcard"
================================================================================================

Two changes this round, both on the Repair Bill feature: (1) a small layout fix on the web
create form's Labour staging row, and (2) splitting the combined Repair Bill list OFF the
create/edit form onto its own page/screen, on both web and Android - confirmed via
AskUserQuestion before building: "Android + Web: both get a separate list screen/page" and
"JobCardScanner rows only (Recommended)" (i.e. the new list shows only bills saved in
JobCardScanner's own database, not the read-only DMSBAPLDATA-synced rows the old combined list
also blended in).

PART 1 - WEB LABOUR STAGING ROW, 1-LINE FIX (web/src/pages/staff/RepairBillCreatePage.tsx):
  - Your screenshot showed the "🔧Labour1 ... Issue Type [button]" staging row dropping its Issue
    Type pills + Add button to a second line at realistic browser widths.
  - Root cause: that row uses the SHARED `.suggest-row` class (also used by JobCardDetailPage.tsx's
    own "Suggest a part"/"Suggest labour" rows), which has `flex-wrap: wrap` baked into
    web/src/styles/global.css - a prior round's `field-compact` change alone couldn't stop it from
    wrapping, since the shared class was still free to wrap the row.
  - Fix: a LOCAL inline `flexWrap: 'nowrap'` override on this one row's own `style` prop (not a
    change to the shared `.suggest-row` class, which stays wrap-capable everywhere else it's used),
    wrapped in a new `overflowX: 'auto'` container - the same horizontal-scroll-on-overflow pattern
    this same file already uses for its Part Details List / Material Transfer grids. On a narrow
    screen the row now scrolls sideways instead of wrapping to a second line.

PART 2 - REPAIR BILL LIST SPLIT OUT TO ITS OWN PAGE/SCREEN:

Backend (backend/JobCardScanner.Api/Controllers/RepairBillDocsController.cs):
  - `Combined()` gets one new optional query param: `ownOnly` (bool, default false). When true, the
    DMSBAPLDATA fetch is skipped entirely (`if (!ownOnly) try { ... fetch DMSBAPLDATA ... } catch
    { ... }`) - the new list pages below never need those rows, so this avoids the extra DMS round-
    trip/failure-sensitivity for them. Default `false` means every EXISTING caller (there were none
    left calling Combined without it by the time this shipped, but this is the safe default
    regardless) is unaffected.
  - No other backend change. Both PUT endpoints the list pages/screens use (`.../status` for Save as
    Invoice, `/{id}` for Edit) already existed from SECTION 80/81.

Web (NEW web/src/pages/staff/RepairBillListPage.tsx; route `/repair-bill-list`):
  - Direct port of the list section that used to render below RepairBillCreatePage.tsx's own
    create/edit form on the SAME page - same column set (Source/SR.No/Bill No/Date/Party Name/
    Reg No/Chassis No/Location/Bill Type/Job No/Bill Amount/Status/Prepared by/Modified by, exactly
    matching what you listed), same filters (Date From/To/Service Location/Bill No/Job No/Chassis
    No - the old "Filter DMSBAPLDATA rows by Party Name" filter is DROPPED here since it only ever
    narrowed the DMSBAPLDATA half this page no longer fetches), same pagination, same read-only
    RecordDetailModal popup (with its own "Save as Invoice" action) for a Billed/Cancelled row.
  - Calls `GET /api/repair-bill-docs/combined?ownOnly=true`, then defensively filters to
    `source === 'JobCardScanner'` client-side too (belt-and-braces, not trusting the query param
    alone).
  - Row click (or its ✎ button), for a still-Performa row, now NAVIGATES to
    `/repair-bill-new?editId={id}` instead of opening the edit form in place (there's no "in place"
    anymore - it's a different page). A Billed/Cancelled row still opens the same read-only popup.
  - New "+ New Repair Bill" button navigates to `/repair-bill-new` (blank form).
  - Registered in web/src/App.tsx (new route `/repair-bill-list`, same role gate as
    `/repair-bill-new`: ServiceAdvisor/WorkshopManager/DealerAdmin/CorporateAdmin/SystemAdmin) and
    web/src/components/StaffLayout.tsx (new sidebar entry "Repair Bill List", positioned between
    "Repair Bill" and "Repair Bill Report").

Web (web/src/pages/staff/RepairBillCreatePage.tsx - now FORM ONLY):
  - The entire old combined-list section (state: party/listBillNo/listJobNo/listChassisNo/
    listLocation/listDateFrom/listDateTo/rows/dmsError/loading; functions: loadCombined/deleteBill/
    saveAsInvoice; the filters card, the list table, the RecordDetailModal popup) is REMOVED from
    this page - it now lives only on RepairBillListPage.tsx above.
  - `startEditBill` simplified from taking a whole `CombinedRepairBillRow` to taking just the bill's
    `id` (all it ever actually used) - and is now ALSO triggered by reading `?editId={id}` off the
    URL on mount (`useSearchParams()`), which is how the new List page's row-click/✎-button open
    this page in edit mode. Clicking the SAME page's own row used to do this in place; now the list
    lives elsewhere, so it has to pass the id via the URL instead.
  - Both `save()`'s success handler and `finalizeEditingBillAsInvoice()` no longer call
    `loadCombined()` (that function no longer exists here) - the List page re-fetches on its own
    mount instead.
  - New "View Repair Bill List" button added next to the page's own `<h2>Repair Bill</h2>` heading,
    navigating to `/repair-bill-list` - since there's no more list to fall through to on this same
    page, this is the way back to it. Intro paragraph text updated to match (no longer describes a
    list "below").
  - `convertingId` state (used by this page's own "Save as Invoice" while editing, i.e.
    `finalizeEditingBillAsInvoice`) is UNCHANGED/kept here - it's unrelated to the list, needed by
    this page's own button.

Android (NEW mobile/src/screens/RepairBillListScreen.tsx; route "RepairBillList"):
  - Same idea as web's RepairBillListPage.tsx, adapted to this app's existing card-list/tap-to-
    expand phone UI pattern (the same pattern the old embedded list in RepairBillCreateScreen.tsx
    used) rather than a table: each row shows Bill No/Source/Status badges, Date/Location/Bill
    Type/Job No, Party/Reg No/Chassis No, item count/total/Prepared by/Modified by - i.e. every
    column from your list, just laid out for a phone screen instead of a table grid. Tapping a row
    expands its item lines, same gesture as before.
  - Filters: Bill No/Job No/Chassis No text fields, Service Location picker (with an explicit "All
    locations" option so the filter can be cleared), Date From/To text fields (YYYY-MM-DD - this
    app has no bare date-picker-only component reused elsewhere for a plain text field context, so
    this matches the plain-text-date pattern already used for other filter-only date fields on
    Android, unlike the header form's own Bill Date/Insurance Valid Till fields which use the native
    date picker since those are real save-critical fields).
  - Calls the same `GET /api/repair-bill-docs/combined?ownOnly=true`, same defensive
    `source === 'JobCardScanner'` filter as web.
  - A still-Performa row's expanded detail gets an "✎ Edit" button - navigates to
    `RepairBillCreate` with `{ editBillId: r.id }` (a new optional nav param, see below) - PLUS a
    "Save as Invoice" button right here (calling the same `PUT .../status` endpoint
    RepairBillCreateScreen.tsx's own finalizeEditingBillAsInvoice uses), so that action isn't lost
    by moving the list off the create screen - this is a small ADDITION beyond a literal 1:1 port
    of the old embedded list (which only had Edit/Delete on a row, no direct Save as Invoice),
    matching what web's RecordDetailModal popup already offered.
  - canDelete-gated Delete button, same SystemAdmin-only rule as the old embedded list had.
  - "+ New" button at the top navigates to a blank `RepairBillCreate` (no `editBillId`).

Android (mobile/src/screens/RepairBillCreateScreen.tsx - now FORM ONLY):
  - The entire old "Combined list" section (state: party/rows/dmsError/loading/expandedId;
    functions: loadCombined/deleteBill; the filter field, the row-rendering JSX) is REMOVED - it now
    lives only on RepairBillListScreen.tsx above. The screen's ScrollView no longer has a
    `refreshControl` (there was nothing left on this screen to "pull to refresh").
  - `startEditBill` simplified from taking a whole `CombinedRepairBillRow` to taking just the bill's
    `id` (mirrors web's same change) - and is now ALSO triggered by a new optional route param,
    `route.params?.editBillId`, read in a mount effect - the Android equivalent of web's `?editId=`
    URL param, since Android has no query string to read instead.
  - `finalizeEditingBillAsInvoice()` and `save()`'s success handler no longer call `loadCombined()`
    (removed) - the List screen re-fetches on its own mount/pull-to-refresh instead.
  - `canDelete`/`hasRole` removed from this screen entirely (only ever used by the now-removed
    Delete button) - `profile` alone is still destructured from `useStaffAuth()`.
  - New "View List" button added next to "New Repair Bill" when NOT currently editing (hidden while
    editing, matching the "Cancel" button that takes its place in that state) - navigates to
    `RepairBillList`.
  - `RootStackParamList`'s `RepairBillCreate` entry changed from `undefined` to
    `{ editBillId?: string } | undefined` (mobile/src/navigation/RootNavigator.tsx), and a new
    `RepairBillList: undefined` entry/`<Stack.Screen>` added there too.
  - DashboardScreen.tsx: new "Repair Bill List" action card added next to the existing "Repair
    Bill" card (whose own subtitle was tightened from "Create & view repair bills" to "Create a
    repair bill", since viewing moved to the new card).

NOT CHANGED: RepairBillDoc/RepairBillDocItem types (web or mobile) - unaffected by this split, the
same GET /api/repair-bill-docs/{id} shape is read by both the create/edit form (on open-for-edit)
and, on web, the list's own RecordDetailModal popup. Material Transfer's own list/create pages -
this round only touches Repair Bill, per your "add this only this page" wording from the round
before.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0 (checked after each of: the
  Labour-row fix alone; the RepairBillCreatePage.tsx list-removal + RepairBillListPage.tsx
  creation together; and again after the App.tsx/StaffLayout.tsx route+nav additions - so the
  whole web project, not just the two Repair Bill files, compiles clean start to finish).
  `npx oxlint src/App.tsx src/components/StaffLayout.tsx src/pages/staff/RepairBillCreatePage.tsx
  src/pages/staff/RepairBillListPage.tsx` -> zero errors (two PRE-EXISTING warnings on
  StaffLayout.tsx, both unrelated to this round's one-line nav-array addition: a "Fast refresh"
  advisory on a constants export, and a "set-state-in-effect" advisory on unrelated code further
  down that file - confirmed present before my edit by their line numbers).
- Android: `cd mobile && npx tsc --noEmit -p tsconfig.json` -> exit 0, whole project (no separate
  lint config exists on this mobile project - tsc is the only automated check available here, same
  as every prior Android round in this changeset).
- Backend: `python3 -c "s=open('Controllers/RepairBillDocsController.cs').read();
  print(s.count('{'), s.count('}'))"` -> 58/58 balanced. No `dotnet build` available in this
  sandbox (NuGet restore blocked by this sandbox's own egress proxy) - this file has NOT been
  compiled, only hand-reviewed and brace-balance-checked; please build/test it on your end before
  deploying.
- Please confirm on your end: (1) both `/repair-bill-list` (web) and the new "Repair Bill List"
  screen (Android) show only this dealer's own JobCardScanner-saved bills, with the DMSBAPLDATA-
  synced rows correctly absent now (previously shown with a "DMSBAPLDATA" badge); (2) clicking/
  tapping a Performa row's Edit affordance on the new list correctly reopens
  RepairBillCreatePage.tsx / RepairBillCreateScreen.tsx pre-filled, and Update Proforma / Save as
  Invoice both still work from there; (3) the Labour staging row on web now stays on one line at
  your usual browser width; (4) Android's new "Save as Invoice" button directly on the list screen
  (an addition beyond a literal port, disclosed above) is something you actually want kept there,
  since it wasn't on the old embedded list at all.

================================================================================================
SECTION 84 - 2026-09-23 - "🔧Labour... still not are in 1 row not added grid button on this clcik
open material transfered job cards history and when open this page when iclick on this jobcard
this in that same we can add labour for save as proforma ..please give proper im asking again and
again" (your screenshots)
================================================================================================

Two things in your message, addressed separately - please read the first one carefully, it likely
explains most of what you're seeing:

(A) FACT, not a new bug: your screenshots (localhost:5173/repair-bill-new) still show the OLD,
pre-merge page - the intro text visible in your screenshot ("The list below shows bills created
here together with the read-only repair bill data synced from DMSBAPLDATA, tagged by source.") is
the EXACT old wording SECTION 83 (delivered just before this one) removed. That's why the Labour
row still looks wrapped in your screenshot too - SECTION 82's row fix and SECTION 83's changes
(including the "✎ Edit" grid button on the Repair Bill list, which SECTION 83 already added) are
sitting in the zip files already sent, not yet merged into the project you're running. Please pull
in the SECTION 83 zip (and this one) before re-checking - if the Labour row is STILL 2 lines after
merging SECTION 83's RepairBillCreatePage.tsx, screenshot that and I'll look again, but the file in
this bundle has the fix.
    Also: the boxed hamburger-style icon (☰) in your second screenshot, top-right of the page near
the browser's own scrollbar - that is NOT anything from this app. StaffLayout.tsx's own doc
comment (2026-09-18) records that the topbar hamburger button was explicitly removed per your own
earlier request, and there is no such element anywhere in this app's current topbar markup
(confirmed by grep - only the BGauss logo, an optional "← Back" button, and the profile menu sit
there). It's most likely a browser/OS element, unrelated to anything built here.

(B) THE ACTUAL GAP - now fixed: re-reading your original ask a third time ("add grid button and in
that that job card shown which will transfer from material transfer to save as proforma using
adding labour details") together with this round's clarification ("click open material transfered
job cards history ... click on this jobcard ... in that same we can add labour for save as
proforma"), the grid button was never meant to be the small "✎ Edit" icon on the Repair Bill LIST
(what SECTION 82/83 built) - it's a SEPARATE button on the CREATE page itself, next to the existing
"Search Job" button, that opens a picker GRID scoped to job cards that ALREADY HAVE a Material
Transfer saved (a "material transfer job card history"), so you can browse/pick one without typing
a Job No - not a generic search. This was NOT built before now; built this round on both web and
Android.

Backend (backend/JobCardScanner.Api/Controllers/JobCardsController.cs):
  - `Search()` (GET /api/jobcards/search) gets one new optional param: `onlyWithMaterialTransfer`
    (bool, default false). When true, an EXISTS check (`_db.MaterialTransferDocs.Any(m =>
    m.JobCardId == j.Id)`) restricts results to job cards that have at least one Material Transfer
    document saved - not a join, so a job with multiple Material Transfer docs still returns once.
    Default false means every existing caller (the plain Search Job/Search buttons on both Repair
    Bill and Material Transfer Bill, both platforms) is completely unaffected.
  - FACT, found while doing this: the Android Job Search picker's own search box
    (mobile/src/components/JobSearchModal.tsx) has been silently broken since it was built -
    it calls this endpoint with a `q` param, but `Search()` has NEVER accepted a `q` param (only
    dateFrom/dateTo/jobNo/regNo/chassisNo, now plus onlyWithMaterialTransfer) - ASP.NET Core
    silently ignores an unrecognized query param rather than erroring, so typing in that search box
    has never actually filtered anything; every open just returns the same up-to-100 most recent
    job cards regardless of what you type. Left AS-IS this round (out of scope for the grid-button
    ask, and worth its own decision - wire the existing box to jobNo/regNo/chassisNo like web's own
    filters, or add a real `q` param server-side) - flagged here rather than silently fixed.

Web (web/src/components/JobSearchModal.tsx - shared by Repair Bill AND Material Transfer Bill):
  - New optional prop `onlyWithMaterialTransfer` (default false). When true: (1) the GET call adds
    `onlyWithMaterialTransfer: true`; (2) the modal auto-runs the search the moment it opens
    (Date From/To still default to "this month", same range as before) instead of waiting for you
    to click Search - matching "click open ... history" i.e. a ready list, not an empty form;
    (3) the header reads "Material Transfer Job Card History" instead of "Job Search"; (4) the
    empty-results message is worded for this mode. Every other usage (this modal's default mode,
    unchanged) is unaffected.
  - web/src/pages/staff/RepairBillCreatePage.tsx: new 🔲 icon button next to "Search Job" in the
    Job No field, opening this SAME modal with `onlyWithMaterialTransfer`. Picking a row calls the
    exact same `selectJob()` the plain Search Job button already uses - once picked, this page's
    EXISTING sync effect (unchanged, pre-dates this round) auto-loads that job's Material Transfer
    Parts, same as linking a job any other way - so all that's left, as you described, is adding
    Labour below and Save as Proforma.

Android (mobile/src/components/JobSearchModal.tsx + mobile/src/screens/RepairBillCreateScreen.tsx):
  - Same `onlyWithMaterialTransfer`/new `title` props added to the shared picker - adds the same
    query param, and swaps the header text when set. (The search-as-you-type box inside it is
    still subject to the pre-existing `q`-param bug noted above - opening the picker still shows
    every matching job card, same as before, just now correctly scoped to ones with a Material
    Transfer.)
  - RepairBillCreateScreen.tsx: new "🔲 MT History" button next to the existing "Search" button on
    the Job No row, opening this same picker in the new mode. Selecting a row calls the same
    `selectJob()` as "Search" - same auto-load-Material-Transfer-Parts-then-add-Labour flow as web.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0.
  `npx oxlint src/pages/staff/RepairBillCreatePage.tsx src/components/JobSearchModal.tsx` -> one
  warning, `react(set-state-in-effect)` on the new auto-search-on-open effect - NOT a new class of
  issue, this exact warning already appears 10+ times elsewhere across this codebase's existing
  "fetch on mount" effects (confirmed via a project-wide `npx oxlint` run) - it's this linter's
  standing advisory style for that whole pattern, not something specific to this change.
- Android: `cd mobile && npx tsc --noEmit -p tsconfig.json` -> exit 0, whole project.
- Backend: NOT compiled (no `dotnet build` available in this sandbox - NuGet restore is blocked by
  this sandbox's own egress proxy) - hand-reviewed only; brace count for JobCardsController.cs
  confirmed balanced (194 open / 194 close) before and after this change. Please build/test on your
  end before deploying, same caveat as every backend change in this whole project.
- Please confirm on your end, after merging BOTH this zip and the SECTION 83 one: (1) the Labour
  row is genuinely on one line now (not just in the file, but as rendered); (2) the new 🔲 button
  next to Search Job/Search opens a grid/list showing ONLY job cards that already have a Material
  Transfer, on both web and Android; (3) picking one from that grid correctly loads its Material
  Transfer Parts and lets you add Labour + Save as Proforma, same as picking via the existing plain
  Search; (4) whether you want the Android search-box `q`-param bug fixed now or separately - it
  predates this round and wasn't something this ask touched.
SECTION 85 - 2026-09-23 - "in repairbill which we added button like this add in material transfer
for showing which we transferred material transferre" (WEB ONLY - see NOT CHANGED note below)
================================================================================================

Mirrors SECTION 83's Repair Bill list split onto Material Transfer Bill: the combined Material
Transfer list (this app's own saved transfers, filters, pagination, Delete, read-only detail popup)
moves OFF MaterialTransferCreatePage.tsx onto its own new page, reached via a header button styled
exactly like the "☰ Repair Bill List" button you pasted back to me from your own merged
RepairBillCreatePage.tsx (I updated my own copy of that file to match your polished version -
inline-flex + gap:6 + the ☰ glyph in its own <span> - before starting this section, so both pages'
header buttons are now visually identical).

Backend (backend/JobCardScanner.Api/Controllers/MaterialTransferDocsController.cs):
  - `Combined()` gets the same `ownOnly` param as RepairBillDocsController's own (SECTION 83): when
    true, the DMSBAPLDATA fetch is skipped entirely. Default `false` - existing callers (there were
    none besides this page's own old embedded list, which is why this method existed at all)
    unaffected.
  - UNLIKE Repair Bill's Combined(), the local (JobCardScanner) half of this endpoint had NO
    filters at all before this round - it just returned every one of this dealer's transfers,
    unfiltered, always. Four new optional params added so the new list page can actually filter:
    `transferNo`, `jobNo` (matches against the linked JobCard's own JobCardNumber), `locationCode`,
    `dateFrom`/`dateTo` (against TransferDate) - each applied only when provided, so calling this
    endpoint with none of them (its old behavior) is unchanged.
  - `locCode`'s existing dual purpose (gates the DMSBAPLDATA fetch AND filters it by workshop) is
    completely unchanged for existing callers - `ownOnly=true` now additionally suppresses it, same
    as Repair Bill's own pattern.

Web (NEW web/src/pages/staff/MaterialTransferListPage.tsx; route `/material-transfer-list`):
  - Direct port of the list section that used to render below MaterialTransferCreatePage.tsx's own
    create/edit form - columns: Source, Transfer No, Date, Location, Type, Party, Job No, Status,
    Items, Amount, Action. Filters: Date From/To, Location, Transfer No, Job No - the old "Filter
    DMSBAPLDATA rows by Party Name" filter is DROPPED here, same reasoning as Repair Bill's own drop
    (it only ever narrowed the DMSBAPLDATA half this page no longer fetches).
  - Calls `GET /api/material-transfer-docs/combined?ownOnly=true` with the new filter params above,
    then defensively filters to `source === 'JobCardScanner'` client-side too, same belt-and-braces
    pattern as Repair Bill's list page.
  - Row click (or ✎ Edit), for a still-Draft row, navigates to `/material-transfer-bill?editId={id}`
    instead of opening the edit form in place. A Confirmed/Cancelled row opens the same read-only
    RecordDetailModal popup as before (no "Confirm Transfer" action in the popup - matches the old
    embedded list, since a Draft row never reached the popup to begin with, it went straight to the
    edit form).
  - FACT, carried over unchanged from the old embedded list (confirmed by re-reading it before
    writing this page): its Delete button has NO `canDelete`/SystemAdmin gate, unlike Repair Bill's
    own list (which IS SystemAdmin-gated). This is a pre-existing asymmetry between the two
    features, not something this round introduced or silently tightened - flagging it here in case
    you want it aligned to match Repair Bill's stricter rule in a future round.
  - New "+ New Material Transfer" button navigates to `/material-transfer-bill` (blank form).
  - Registered in web/src/App.tsx (new route `/material-transfer-list`, same role gate as
    `/material-transfer-bill`: ServiceAdvisor/WorkshopManager/DealerAdmin/CorporateAdmin/
    SystemAdmin) and web/src/components/StaffLayout.tsx (new sidebar entry "Material Transfer
    List", positioned between "Material Transfer Bill" and "Material Transfer" report).

Web (web/src/pages/staff/MaterialTransferCreatePage.tsx - now FORM ONLY):
  - The entire old combined-list section (state: locCode/rows/dmsError/loading/viewingTransfer;
    functions: loadCombined/deleteTransfer; the DMS-workshop filter card, the list table with its
    Pagination, the RecordDetailModal popup) is REMOVED - it now lives only on
    MaterialTransferListPage.tsx above.
  - `startEditTransfer` simplified from taking a whole `CombinedMaterialTransferRow` to taking just
    the transfer's `id` (all it ever actually used) - and is now ALSO triggered by reading
    `?editId={id}` off the URL on mount (`useSearchParams()`), same mechanism as Repair Bill's own
    `?editId=`.
  - Both `save()`'s success handler and `finalizeEditingTransferAsConfirmed()` no longer call
    `loadCombined()` (that function no longer exists here) - the List page re-fetches on its own
    mount instead.
  - New "☰ Material Transfer List" button added next to the page's own `<h2>Material Transfer
    Bill</h2>` heading (same styling as Repair Bill's, per your pasted reference), navigating to
    `/material-transfer-list`. Intro paragraph text updated to match (no longer describes a list
    "below").
  - `convertingId` state (used by this page's own "Confirm Transfer" while editing) is UNCHANGED/
    kept here - it's unrelated to the list, needed by this page's own button. A duplicate
    declaration was accidentally introduced mid-edit and caught/removed before this file reached
    you - final file has exactly one.

NOT CHANGED - Android (mobile/src/screens/MaterialTransferCreateScreen.tsx): this round's actual
ask ("in repairbill which we added button like this add in material transfer... material
transferre") was stated against, and demonstrated with, your own pasted WEB file - so only the web
side was built this round, matching that scope. Two FACTS worth flagging before Android gets the
same treatment: (1) unlike Repair Bill, Android's Material Transfer create screen currently has NO
reopen-as-editable flow at all (no editingTransferId/startEditTransfer/route param anywhere in that
file, confirmed by grep) - web's Material Transfer already had this from an earlier round, and
Android's own Repair Bill screen got it in SECTION 80/83, but Android Material Transfer never has;
(2) that means an Android list screen mirroring this round's web page 1:1 would need that missing
edit flow built FIRST (a real, separate piece of work, not a small addition), or the Android list
would have to ship Delete-only with no Edit, unlike every other list in this app. Recommend: tell me
which you want - build the edit flow now so Android gets full parity, or ship Android's list
Delete-only for now and revisit Edit later - rather than me guessing and building the wrong scope.

VERIFICATION:
- Web: `cd web && npx tsc -p tsconfig.app.json --noEmit` -> exit 0, whole project, checked after
  the MaterialTransferCreatePage.tsx list-removal + MaterialTransferListPage.tsx creation +
  App.tsx/StaffLayout.tsx route+nav additions + RepairBillCreatePage.tsx button-style touch-up,
  all together.
  `npx oxlint` (whole project) -> zero warnings/errors on any file this section touched
  (MaterialTransferCreatePage.tsx, MaterialTransferListPage.tsx, App.tsx, StaffLayout.tsx,
  RepairBillCreatePage.tsx); the pre-existing StaffLayout.tsx "Fast refresh" advisory (same one
  noted in SECTION 83, unrelated to either round's nav-array edits) is still the only warning on
  that file.
- Backend: `python3 -c "s=open('Controllers/MaterialTransferDocsController.cs').read();
  print(s.count('{'), s.count('}'))"` -> 72/72 balanced, both before and after. No `dotnet build`
  available in this sandbox (NuGet restore blocked by this sandbox's own egress proxy) - hand-
  reviewed and brace-balance-checked only; please build/test on your end before deploying, same
  caveat as every backend change in this whole project.
- Please confirm on your end: (1) `/material-transfer-list` shows only this dealer's own
  JobCardScanner-saved transfers, with the new Date/Location/Transfer No/Job No filters actually
  narrowing results; (2) clicking/✎-editing a Draft row correctly reopens
  MaterialTransferCreatePage.tsx pre-filled via `?editId=`, and Update Draft / Confirm Transfer both
  still work from there; (3) the new "☰ Material Transfer List" header button matches "☰ Repair
  Bill List" visually, side by side; (4) whether Material Transfer's Delete-with-no-role-gate
  (flagged above, pre-existing, unchanged) should be tightened to match Repair Bill's SystemAdmin-
  only rule; (5) your decision on the Android Material Transfer edit-flow gap flagged above, before
  I build that platform's list screen.

================================================================================================
