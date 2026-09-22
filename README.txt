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
