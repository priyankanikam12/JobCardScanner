#!/usr/bin/env node
'use strict'
/**
 * BGauss DMS - VAPT re-test (Securepoint report v1.0, 17.10.2026). Safe to run against PRODUCTION (there is no UAT): it replays the report's proof-of-concept requests, but
 *   1. FIRST it asks two READ-ONLY questions - "does the route guard refuse a DealerAdmin on an admin-only GET?" and "does the dealer scope refuse a Captain on another dealer's job card (GET)?".
 *      Only when the server answers "yes, enforced" does it send the write-style requests (create a SystemAdmin, edit another dealer's job card ...). In LogOnly / not-deployed mode those requests
 *      WOULD go through, so they are skipped - nothing is created or changed on the server.
 *   2. --readonly never sends a write at all.
 *   3. The only writes that can still reach the server are on YOUR TEST JOB CARD (--test-jobcard): an HTML file declared as a photo (DMS-06) and a negative labour rate (DMS-08). If the server wrongly accepts
 *      one, the script says FAIL and removes what it created where it can.
 * Needs Node 18+ (nothing to install). Tokens are read from the environment (never stored):
 *      set VAPT_DEALERADMIN_TOKEN=...   (a DealerAdmin test login)
 *      set VAPT_CAPTAIN_TOKEN=...       (a Captain / ServiceAdvisor test login of the SAME dealer as --test-jobcard)
 *      set VAPT_SUPERVISOR_TOKEN=...    (a Supervisor / ViceCaptain test login)
 * Usage:  node vapt-retest.js --base https://dms.bgauss.com [--readonly] [--test-jobcard <guid>] [--other-jobcard <guid>] [--other-dealer <guid>] [--keep-session]
 *   --test-jobcard   an open job card of the Captain's dealer made for testing (needs a Technician assigned and, for the photo check, at least one photo)
 *   --other-jobcard  a job card of ANOTHER dealer (only read, and edited only when the scope is proven to be enforced)
 *   --keep-session   do not sign the Captain token out at the end (DMS-16 is skipped)
 * Exit code 0 = no FAIL, 1 = at least one FAIL.
 */
const args = {}
{
  const a = process.argv.slice(2)
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue
    const k = a[i].slice(2)
    if (a[i + 1] === undefined || a[i + 1].startsWith('--')) args[k] = true
    else args[k] = a[++i]
  }
}
const base = String(args.base || '').replace(/\/$/, '')
if (!base) { console.error('Usage: node vapt-retest.js --base https://dms.bgauss.com [--readonly] [--test-jobcard <guid>] [--other-jobcard <guid>] [--other-dealer <guid>] [--keep-session]'); process.exit(2) }
const T = { dealerAdmin: process.env.VAPT_DEALERADMIN_TOKEN, captain: process.env.VAPT_CAPTAIN_TOKEN, supervisor: process.env.VAPT_SUPERVISOR_TOKEN }
const readonly = !!args.readonly
let pass = 0, fail = 0, skip = 0
const cleanup = []
const guid = () => '00000000-0000-4000-8000-' + String(Date.now()).padStart(12, '0').slice(-12)

async function call(method, path, o = {}) {
  const headers = { ...(o.headers || {}) }
  if (o.token) headers.Authorization = 'Bearer ' + o.token
  let body
  if (o.form) body = o.form
  else if (o.body !== undefined) { headers['Content-Type'] = 'application/json'; body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body) }
  try {
    const r = await fetch(base + path, { method, headers, body, redirect: 'manual' })
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    return { status: r.status, text, json, headers: r.headers }
  } catch (e) {
    return { status: 0, text: String(e && e.message), json: null, headers: new Headers() }
  }
}
const ok = (id, text, cond, detail = '') => { if (cond) { pass++; console.log(`PASS  ${id.padEnd(7)} ${text}`) } else { fail++; console.log(`FAIL  ${id.padEnd(7)} ${text}  -> ${detail}`) } }
const skp = (id, text, why) => { skip++; console.log(`SKIP  ${id.padEnd(7)} ${text}  (${why})`) }
const isDenied = (s) => s === 401 || s === 403

/** A request that must be refused. Write-style requests only run when `allowed` (the guard was proven to enforce); a 2xx answer is recorded as data to clean up. */
async function denied(id, text, method, path, token, body, allowed, whyNot) {
  if (!token) return skp(id, text, 'token not set')
  if (method !== 'GET' && !allowed) return skp(id, text, whyNot)
  const r = await call(method, path, { token, body })
  if (method !== 'GET' && r.status >= 200 && r.status < 300) cleanup.push(`${id}: ${method} ${path} was ACCEPTED (HTTP ${r.status}) - check and undo what it created`)
  ok(id, text, isDenied(r.status), `expected 401/403, got ${r.status}`)
}

;(async () => {
  console.log(`Target: ${base}${readonly ? '   (read-only: no write requests)' : ''}\n`)

  // ---- canaries: two read-only questions that decide whether write-style tests may run -------------------------------------------------------------------------
  let guardEnforced = null
  const probe = T.dealerAdmin || T.captain
  if (probe) {
    const r = await call('GET', '/api/admin/azure-directory/users', { token: probe })
    guardEnforced = isDenied(r.status) ? true : (r.status >= 200 && r.status < 300 ? false : null)
    ok('DMS-02', 'a dealer login cannot read the Azure directory (GET /api/admin/azure-directory/users)', isDenied(r.status), `got ${r.status}${guardEnforced === false ? ' - the route guard is NOT enforcing (LogOnly or not deployed)' : ''}`)
  } else skp('DMS-02', 'route guard canary', 'DealerAdmin / Captain token not set')
  const guardWhy = readonly ? '--readonly' : guardEnforced === null ? 'route guard state unknown - write tests skipped to protect production data' : 'RouteGuardMode is not Enforce on this server - write tests skipped to protect production data'
  const guardWrites = !readonly && guardEnforced === true

  let scopeEnforced = null
  if (T.captain && args['other-jobcard']) {
    const r = await call('GET', `/api/jobcards/${args['other-jobcard']}`, { token: T.captain })
    scopeEnforced = r.status === 403 ? true : (r.status === 200 ? false : null)
    ok('DMS-07', "Captain cannot READ another dealer's job card (GET)", r.status === 403, `got ${r.status}${scopeEnforced === false ? ' - the dealer scope is NOT enforcing (LogOnly or not deployed)' : ''}`)
  } else skp('DMS-07', 'dealer scope canary', 'needs --other-jobcard and the Captain token')
  const scopeWhy = readonly ? '--readonly' : 'DealerScopeMode is not Enforce on this server (or not proven) - write tests skipped to protect production data'
  const scopeWrites = !readonly && scopeEnforced === true

  // ---- High -------------------------------------------------------------------------------------------------------------------------------------------------------
  await denied('DMS-01', 'DealerAdmin changes a role to SystemAdmin (PUT /api/users/{id})', 'PUT', `/api/users/${guid()}`, T.dealerAdmin, { role: 'SystemAdmin' }, guardWrites, guardWhy)
  await denied('DMS-05', 'DealerAdmin creates a SystemAdmin (POST /api/users)', 'POST', '/api/users', T.dealerAdmin, { name: 'vapt test', email: 'vapt.test@example.invalid', role: 'SystemAdmin' }, guardWrites, guardWhy)
  await denied('DMS-05', 'a role sent as a number is refused for a dealer login', 'POST', '/api/users', T.dealerAdmin, { name: 'vapt test', email: 'vapt.test2@example.invalid', role: 9 }, guardWrites, guardWhy)
  await denied('DMS-04', 'Captain writes a vehicle registration override', 'POST', '/api/vehicle-sale-overrides', T.captain, {}, guardWrites, guardWhy)
  await denied('DMS-04', 'Captain writes the menu / role matrix', 'PUT', '/api/menu-access', T.captain, [], guardWrites, guardWhy)
  await denied('DMS-04', 'Captain writes the role modes', 'PUT', '/api/menu-access/role-modes', T.captain, [], guardWrites, guardWhy)
  if (T.captain && args['other-jobcard']) {
    await denied('DMS-07', "Captain edits ANOTHER dealer's job card (PUT)", 'PUT', `/api/jobcards/${args['other-jobcard']}`, T.captain, { assignedTechnicianName: 'vapt' }, scopeWrites, scopeWhy)
    await denied('DMS-07', "Captain adds an inspection to ANOTHER dealer's job card", 'POST', `/api/jobcards/${args['other-jobcard']}/inspections`, T.captain, { component: 'General', condition: 'NeedsAttention', notes: 'vapt' }, scopeWrites, scopeWhy)
  } else skp('DMS-07', "cross-dealer job card write", 'needs --other-jobcard and the Captain token')
  if (T.captain && args['other-dealer']) await denied('DMS-03', 'Captain creates a customer under another dealerId', 'POST', '/api/customers', T.captain, { dealerId: args['other-dealer'], name: 'vapt test', mobile: '9000000000' }, scopeWrites, scopeWhy)
  else skp('DMS-03', 'customer under another dealerId', 'needs --other-dealer and the Captain token')

  // ---- DMS-06 / DMS-08 on the TEST job card only --------------------------------------------------------------------------------------------------------------------
  const tj = args['test-jobcard']
  if (T.captain && tj && !readonly) {
    const form = new FormData()
    form.append('File', new Blob(['<html><body>vapt-marker</body></html>'], { type: 'image/png' }), 'poc.png.html')
    form.append('Stage', 'CheckIn')
    const r = await call('POST', `/api/jobcards/${tj}/photos/upload`, { token: T.captain, form })
    if (r.status >= 200 && r.status < 300) cleanup.push(`DMS-06: the HTML "photo" was ACCEPTED on test job card ${tj} - delete that photo and the file poc.png.html under wwwroot\\uploads`)
    ok('DMS-06', 'an HTML file declared as image/png is refused at upload', r.status >= 400 && r.status < 500, `got ${r.status} - UploadPhoto still accepts it`)

    for (const [label, rate, qty] of [['negative rate (-100)', -100, 1], ['quantity 999999999', 100, 999999999]]) {
      const r8 = await call('POST', `/api/jobcards/${tj}/labour-suggestions`, { token: T.captain, body: { labourCode: 'VAPT', labourDescription: 'vapt test', quantity: qty, rateAtSuggestion: rate, sgst: 0, cgst: 0, igst: 0 } })
      if (r8.status >= 200 && r8.status < 300) {
        const created = r8.json && r8.json.id
        const del = created ? await call('DELETE', `/api/jobcards/labour-suggestions/${created}`, { token: T.captain }) : null
        cleanup.push(`DMS-08: a labour line with ${label} was ACCEPTED on test job card ${tj}${created ? ` (removal answered ${del.status})` : ' - remove it by hand'}`)
        ok('DMS-08', `labour line with ${label} is refused`, false, `got ${r8.status} - the API still accepts it`)
      } else if (r8.status === 400 && /rate|price|quantity|between|at most/i.test(r8.text)) ok('DMS-08', `labour line with ${label} is refused`, true)
      else skp('DMS-08', `labour line with ${label}`, `inconclusive: HTTP ${r8.status} ${r8.text.slice(0, 90)} (a Technician must be assigned to the test job card)`)
    }
  } else skp('DMS-06/08', 'HTML upload and negative / huge price on the test job card', readonly ? '--readonly' : 'needs --test-jobcard and the Captain token')

  // ---- Medium -----------------------------------------------------------------------------------------------------------------------------------------------------
  await denied('DMS-09', 'Supervisor writes the service catalogue', 'POST', '/api/service-menu-master', T.supervisor, {}, guardWrites, guardWhy)
  await denied('DMS-09', 'Supervisor writes the battery-warranty schemes', 'POST', '/api/extended-battery-warranty-schemes', T.supervisor, {}, guardWrites, guardWhy)
  await denied('DMS-10', 'Captain creates a workflow stage', 'POST', '/api/workflow-stages', T.captain, {}, guardWrites, guardWhy)

  const codes = []
  for (let i = 0; i < 25; i++) codes.push((await call('POST', '/api/dealer-auth/login', { body: { email: 'vapt.nobody@example.invalid', password: 'wrong-' + i } })).status)
  ok('DMS-11', '25 failed logins in a row get HTTP 429 at some point (your own address is slowed for about a minute)', codes.includes(429), 'statuses seen: ' + [...new Set(codes)].join(','))

  const forgot = await call('POST', '/api/dealer-auth/forgot-password', { body: { email: 'vapt.nobody@example.invalid' } })
  ok('DMS-12', 'forgot-password never returns a reset token (devResetToken)', !/devResetToken/i.test(forgot.text), 'the response contains devResetToken')
  const otp = await call('POST', '/api/portal/otp/request', { body: { mobile: '0000000000' } })
  ok('DMS-12', 'an OTP request never returns the code (devOtpCode)', !/devOtpCode/i.test(otp.text), 'the response contains devOtpCode')
  console.log(`INFO  DMS-12  OTP request for an unregistered number answered HTTP ${otp.status} - it must look the SAME as for a registered number (needs the OtpService fix; compare by hand)`)

  const home = await call('GET', '/')
  for (const n of ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) ok('DMS-13', `response header ${n} is present`, home.headers.get(n) !== null, 'missing')
  ok('DMS-13', 'Content-Security-Policy (or its report-only form) is present', home.headers.get('content-security-policy') !== null || home.headers.get('content-security-policy-report-only') !== null, 'missing')
  if (base.startsWith('https')) ok('DMS-13', 'Strict-Transport-Security is present', home.headers.get('strict-transport-security') !== null, 'missing')
  ok('DMS-13', 'X-Powered-By is absent', home.headers.get('x-powered-by') === null, 'still sent (merge the web.config change)')
  ok('DMS-13', 'the Server header does not name IIS', !/iis/i.test(home.headers.get('server') || ''), `Server: ${home.headers.get('server')}`)

  // ---- Low ---------------------------------------------------------------------------------------------------------------------------------------------------------
  if (T.captain) {
    const d = await call('GET', '/api/dealers', { token: T.captain })
    let leaks = -1
    if (Array.isArray(d.json)) leaks = d.json.filter((row) => Object.keys(row).some((k) => /mail|phone|mobile|contact/i.test(k) && row[k])).length
    ok('DMS-15', "GET /api/dealers shows contact details for at most the caller's own dealer", leaks >= 0 && leaks <= 1, `rows with contact fields: ${leaks}`)
  } else skp('DMS-15', '/api/dealers contact fields', 'Captain token not set')
  console.log('INFO  DMS-15  GET /api/menu-access still returns the whole role matrix to every login (needs MenuAccessController - open item)')

  if (T.captain && tj) {
    const det = await call('GET', `/api/jobcards/${tj}`, { token: T.captain })
    const url = det.json && Array.isArray(det.json.photos) && det.json.photos[0] && det.json.photos[0].url
    if (!url) skp('DMS-14', 'photo addresses are signed', 'the test job card has no photo - upload one in the app first')
    else {
      ok('DMS-14', 'the API returns the photo address with an expiring signature (?exp=&sig=)', /[?&]sig=/.test(url) && /[?&]exp=/.test(url), url.split('?')[0])
      const plain = await call('GET', url.split('?')[0])
      ok('DMS-14', 'the same photo WITHOUT a signature and without a login is not served', plain.status === 404 || isDenied(plain.status), `got ${plain.status}`)
      const signed = await call('GET', url)
      ok('DMS-14', 'the signed address works (so the app still shows the photo)', signed.status === 200, `got ${signed.status}`)
    }
  } else skp('DMS-14', 'photo addresses are signed', 'needs --test-jobcard and the Captain token')

  if (T.captain && !readonly && !args['keep-session']) {
    const out = await call('POST', '/api/session/logout', { token: T.captain })
    const me = await call('GET', '/api/auth/me', { token: T.captain })
    ok('DMS-16', 'after sign-out the same token is refused (HTTP 401)', (out.status === 204 || out.status === 200) && me.status === 401, `logout ${out.status}, then /api/auth/me ${me.status}`)
  } else skp('DMS-16', 'token refused after sign-out', readonly ? '--readonly' : args['keep-session'] ? '--keep-session' : 'Captain token not set')

  console.log(`\nResult: ${pass} passed, ${fail} failed, ${skip} skipped.`)
  if (cleanup.length) { console.log('\nCLEANUP NEEDED (a fix is not working and the server accepted a test request):'); cleanup.forEach((c) => console.log('  - ' + c)) }
  console.log('\nStill manual: DMS-12 (identical OTP answers for registered / unregistered numbers), DMS-15 (/api/menu-access matrix), DMS-16 (token lifetime of the dealer login, role / password change).')
  process.exit(fail ? 1 : 0)
})()
