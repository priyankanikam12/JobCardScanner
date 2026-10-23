Labour Suggestion - "Add Suggestion" did nothing (23.10.2026)

CAUSE (my VAPT change, 23.10.2026): JobCardsController.AddLabourSuggestion checked the labour line's GST against the statutory PERCENT list (9, 18 ...), but the Labour Master keeps GST as a FRACTION
(0.09, 0.18 - the Repair Bill page multiplies it by 100). So every labour line picked from the catalogue was refused with HTTP 400 "CGST / SGST must be one of ...". The reason was shown only in the line at the very
TOP of the page, far from the Labour card, so it looked as if nothing happened. Part suggestions were not affected (no GST check).

FIX
  backend\...\Controllers\JobCardsController.cs   GstAsPercent(): a value between 0 and 1 is a fraction and is turned into percent for the check (a value typed as 9 / 18 still works). What is saved is
      exactly what was sent. Still refused: made-up rates (0.07), 99% GST, negative price, quantity above 10,000.
  web\src\pages\staff\JobCardDetailPage.tsx       (full file) - a refused "Add Suggestion" (Part and Labour) now says why right UNDER the row, in red, and keeps what you picked so you can retry.
  UI of the Part / Labour rows and tables: one height for every box and button of the row (38px), labels above, the Add button aligned with the boxes, the row wraps on a narrow screen instead of scrolling
      sideways; the saved lines' action cells are proper table cells (they were display:flex on the <td>, which broke the row lines) with Edit / Discount / Remove / Save / Cancel in one tidy line;
      the e-mail row of the Estimates Amount card uses the same sizes.
  web\src\components\suggest-row.css              NEW - copy it next to the other components (the page imports it).
The Android Labour / Part suggestion screens call the same API, so the server fix is what makes them add again too.

ORDER: deploy the API first (that is what fixes the add), then the web build.
Checked: the labour GST check with the real values (0.09 / 0.09 / 0.18, 0.025 / 0.05, 0.14 / 0.28, 0.2 / 0.4, 9 / 9 / 18, none) passes; made-up values and a negative rate are still refused (44 in-process checks pass);
web tsc 0 errors, production build OK, 4 new tests (add with fraction GST, refused add shows its reason under the row, no-timer message, row layout) + the 12 earlier pass.
NOT checked: the full backend build (the controller was only syntax-checked) and how the row looks in a real browser (no screenshot available).
