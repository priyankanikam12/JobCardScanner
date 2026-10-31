#!/usr/bin/env node
'use strict'
/**
 * BGauss DMS - VAPT retest DMS-03 (31.10.2026): "a dealer is allowed to search other dealer's customer through Chassis No".
 *   node patch-retest-dms03.js "<Controllers\\JobCardsController.cs>" "<Services\\DmsBaplDataService.cs>"
 * Cause: the wizard's chassis lookup (GET /api/jobcards/vehicle-lookup) first searches the sale bills of the caller's own dealer only. When that finds nothing it falls back to the older sales table
 * DMS_VehicleSales (DMS_IOT_DATA) by chassis number ALONE - so for a vehicle sold by another dealer the fallback returned that dealer's customer (name, mobile, e-mail, address).
 * Fix:
 *   1. DmsBaplDataService.LookupVehicleForWizardAsync: the fallback row is used only when it belongs to the caller's dealer (DealerCode, or the location code starting with it). A dealer-scoped lookup that
 *      finds nothing now simply finds nothing (the wizard falls back to manual entry, as the code comments always said it would).
 *   2. JobCardsController vehicle-lookup and vehicle-suggestions: a dealer login whose dealer has NO BAPL dealer code used to be searched without any dealer filter at all; it now gets "not found" / an empty list.
 * CorporateAdmin / SystemAdmin are unchanged (org-wide). Backups "<file>.before-retest" are written; every anchor must be found exactly once or NOTHING is changed.
 */
const fs = require('fs')
const [ctl, svc] = process.argv.slice(2)
if (!ctl || !svc) { console.error('Usage: node patch-retest-dms03.js "<JobCardsController.cs>" "<DmsBaplDataService.cs>"'); process.exit(2) }

function prepare(file, marker, edits) {
  const raw = fs.readFileSync(file, 'utf8'), crlf = raw.includes('\r\n')
  let t = raw.replace(/\r\n/g, '\n')
  if (t.includes(marker)) { console.log(`${file}: already patched`); return null }
  const count = (e) => (e.re ? (t.match(new RegExp(e.re.source, 'g')) || []).length : t.split(e.find).length - 1)
  for (const e of edits) {
    if (e.skipIf && t.includes(e.skipIf)) continue
    const n = count(e)
    if (n !== 1) { console.error(`NOT APPLIED to ${file} - expected exactly 1 match, found ${n} for:\n  ${(e.re ? e.re.source : e.find.split('\n')[0]).trim().slice(0, 90)} ...`); process.exit(1) }
  }
  for (const e of edits) { if (e.skipIf && t.includes(e.skipIf)) continue; t = e.re ? t.replace(e.re, e.fn) : t.replace(e.find, () => e.replace) }
  return { file, raw, out: crlf ? t.replace(/\n/g, '\r\n') : t }
}

const A = prepare(ctl, 'DealerScope.IsCorporate', [
  { skipIf: 'using JobCardScanner.Api.Security;', find: 'using JobCardScanner.Api.Data;\n', replace: 'using JobCardScanner.Api.Data;\nusing JobCardScanner.Api.Security;\n' },
  {
    find: '        DmsBaplDataVehicleSaleRow? hit;\n',
    replace: `        // 2026-10-31 (VAPT retest DMS-03): a dealer login is only ever shown ITS OWN dealer's sales. A dealer with no BAPL dealer code used to be searched with no dealer filter at all - it now finds nothing.
        if (string.IsNullOrWhiteSpace(dealerCode) && !DealerScope.IsCorporate(User)) return NotFound(new { message = $"\\"{value}\\" wasn't found in Vehicle Sale." });

        DmsBaplDataVehicleSaleRow? hit;
`,
  },
  {
    find: '        try\n        {\n            var hits = await _dmsBaplData.SearchVehiclesForWizardAsync(',
    replace: `        // 2026-10-31 (VAPT retest DMS-03): same rule as vehicle-lookup - no BAPL dealer code, no unscoped search for a dealer login.
        if (string.IsNullOrWhiteSpace(dealerCode) && !DealerScope.IsCorporate(User)) return Ok(Array.Empty<object>());

        try
        {
            var hits = await _dmsBaplData.SearchVehiclesForWizardAsync(`,
  },
])

const indent = (text, pad) => text.split('\n').map((l) => (l.length ? pad + l : l)).join('\n')
const B = prepare(svc, 'IsSameDealer', [
  {
    re: /\n([ \t]*)var iotRow = await GetLatestVehicleSaleFromDmsIotDataAsync\(chassisForIotLookup, ct\);\n([ \t]*)if \(iotRow is not null\)\n/,
    fn: (_m, pad) => `
${pad}var iotRow = await GetLatestVehicleSaleFromDmsIotDataAsync(chassisForIotLookup, ct);
${pad}// 2026-10-31 (VAPT retest DMS-03): DMS_VehicleSales is searched by chassis no. alone, so for a vehicle sold by ANOTHER dealer it returned that dealer's customer. When the lookup is scoped to a dealer
${pad}// (dealerCode given), a row of another dealer is ignored - exactly as the DMS_SaleBill search above already ignores it.
${pad}if (iotRow is not null && !string.IsNullOrWhiteSpace(dealerCode) && !IsSameDealer(iotRow, dealerCode)) iotRow = null;
${pad}if (iotRow is not null)
`,
  },
  {
    re: /\n([ \t]*)public async Task<DmsBaplDataVehicleSaleRow\?> LookupVehicleForWizardAsync\(string value, string\? dealerCode, CancellationToken ct = default\)\n/,
    fn: (_m, pad) => `
${pad}/// <summary>2026-10-31 (VAPT retest DMS-03): does this sale row belong to the dealer? By dealer code, or by a location code that starts with it (CUS0288W4 belongs to CUS0288).</summary>
${pad}private static bool IsSameDealer(DmsBaplDataVehicleSaleRow row, string dealerCode)
${pad}{
${pad}    var code = dealerCode.Trim();
${pad}    return string.Equals(row.DealerCode?.Trim(), code, StringComparison.OrdinalIgnoreCase)
${pad}        || (row.LocCode?.Trim().StartsWith(code, StringComparison.OrdinalIgnoreCase) ?? false);
${pad}}

${pad}public async Task<DmsBaplDataVehicleSaleRow?> LookupVehicleForWizardAsync(string value, string? dealerCode, CancellationToken ct = default)
`,
  },
])

for (const r of [A, B]) {
  if (!r) continue
  fs.writeFileSync(r.file + '.before-retest', r.raw)
  fs.writeFileSync(r.file, r.out)
  console.log(`patched: ${r.file}   (backup: ${r.file}.before-retest)`)
}
