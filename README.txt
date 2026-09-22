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
