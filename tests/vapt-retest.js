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
 * Usage:  node vapt-retest.js --base https://dms.bgauss.com [--readonly] [--test-jobcard <guid>] [--other-jobcard <guid>] [--other-dealer <guid>] [--keep-session] [--registered-mobile <n> --unregistered-mobile <n>]
 *   --registered-mobile / --unregistered-mobile   (DMS-12, optional, give BOTH) a TEST customer's mobile number and a number you KNOW is not registered: the OTP request and verify answers for the two are compared.
 *                    The registered one really receives an OTP (SMS, or the dev code on screen) - use a test customer, never a real one; the unregistered one must really be unregistered.
 *   --test-jobcard   an open job card of the Captain's dealer made for testing (needs a Technician assigned and, for the photo check, at least one photo)
 *   --other-jobcard  a job card of ANOTHER dealer (only read, and edited only when the scope is proven to be enforced)
 *   --workarea-jobcard (DMS-07, 31.10.2026) a job card of the SAME dealer at a location OUTSIDE the Captain login's Work Area: hidden from the list and the card page, so it must not be writable either
 *   --other-chassis  (DMS-03, 2026-10-31) the chassis number of a vehicle sold by ANOTHER dealer: the wizard's chassis lookup must not return that dealer's customer to the Captain
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
    // 2026-10-31 (retest DMS-07): the same job card with its id written without hyphens (the route accepts that form too) and in capitals - both are reads, so they also run with --readonly
    const plain = String(args['other-jobcard']).replace(/-/g, '')
    const r2 = await call('GET', `/api/jobcards/${plain}`, { token: T.captain })
    ok('DMS-07', "the same job card with its id written WITHOUT hyphens is refused too (GET)", r2.status === 403 || (scopeEnforced === null && isDenied(r2.status)), `got ${r2.status}${r2.status === 200 ? ' - the filter does not recognise this form of the id' : ''}`)
    const r3 = await call('GET', `/api/jobcards/${String(args['other-jobcard']).toUpperCase()}`, { token: T.captain })
    ok('DMS-07', "... and in capital letters (GET)", r3.status === 403 || (scopeEnforced === null && isDenied(r3.status)), `got ${r3.status}`)
  } else skp('DMS-07', 'dealer scope canary', 'needs --other-jobcard and the Captain token')
  // 2026-10-31 (retest DMS-07, evidence of 30.10.2026): a card of the SAME dealer outside the login's Work Area is hidden from lists and search - and must not be editable by its id either
  let workAreaEnforced = null
  if (T.captain && args['workarea-jobcard']) {
    const r = await call('GET', `/api/jobcards/${args['workarea-jobcard']}`, { token: T.captain })
    workAreaEnforced = r.status === 403 ? true : false
    ok('DMS-07', "a job card of the same dealer OUTSIDE the login's Work Area is refused by the ownership rule (GET)", r.status === 403, `got ${r.status}${r.status === 404 ? ' - only the card page hides it; the Work Area rule is not applied to the API rules yet' : r.status === 200 ? ' - readable' : ''}`)
  } else skp('DMS-07', "job card outside the login's Work Area", 'needs --workarea-jobcard (a card of the same dealer at another location) and the Captain token')
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
    await denied('DMS-07', "Captain edits ANOTHER dealer's job card with its id written without hyphens (PUT)", 'PUT', `/api/jobcards/${String(args['other-jobcard']).replace(/-/g, '')}`, T.captain, { assignedTechnicianName: 'vapt' }, scopeWrites, scopeWhy)
    await denied('DMS-07', "Captain adds an inspection to ANOTHER dealer's job card", 'POST', `/api/jobcards/${args['other-jobcard']}/inspections`, T.captain, { component: 'General', condition: 'NeedsAttention', notes: 'vapt' }, scopeWrites, scopeWhy)
  } else skp('DMS-07', "cross-dealer job card write", 'needs --other-jobcard and the Captain token')
  if (T.captain && args['workarea-jobcard']) await denied('DMS-07', "Captain edits a job card of the same dealer OUTSIDE its Work Area by its id (PUT)", 'PUT', `/api/jobcards/${args['workarea-jobcard']}`, T.captain, { assignedTechnicianName: 'vapt', expectedDeliveryAt: '2026-10-20T10:00:00' }, !readonly && workAreaEnforced === true, readonly ? '--readonly' : 'the Work Area rule is not proven for this card (the GET above was not refused with 403) - write test skipped to protect production data')
  if (T.captain && args['other-dealer']) await denied('DMS-03', 'Captain creates a customer under another dealerId', 'POST', '/api/customers', T.captain, { dealerId: args['other-dealer'], name: 'vapt test', mobile: '9000000000' }, scopeWrites, scopeWhy)
  else skp('DMS-03', 'customer under another dealerId', 'needs --other-dealer and the Captain token')
  // 2026-10-31 (retest DMS-03): searching another dealer's customer by chassis number (reads only, so it also runs with --readonly)
  if (T.captain && args['other-chassis']) {
    const chassis = String(args['other-chassis'])
    const lk = await call('GET', `/api/jobcards/vehicle-lookup?value=${encodeURIComponent(chassis)}`, { token: T.captain })
    const leaked = lk.status === 200 && lk.json && (lk.json.customerName || lk.json.customerMobile || lk.json.customerAddress)
    ok('DMS-03', "the chassis lookup does not return ANOTHER dealer's customer (GET /api/jobcards/vehicle-lookup)", lk.status === 404 || (lk.status === 200 && !leaked) || isDenied(lk.status), `got ${lk.status}${leaked ? ' - customer details of another dealer are returned' : ''}`)
    const sg = await call('GET', `/api/jobcards/vehicle-suggestions?q=${encodeURIComponent(chassis)}`, { token: T.captain })
    const listed = Array.isArray(sg.json) && sg.json.some((v) => String(v.chassisNo || '').trim().toLowerCase() === chassis.trim().toLowerCase())
    ok('DMS-03', "the chassis suggestions do not list another dealer's vehicle (GET /api/jobcards/vehicle-suggestions)", !listed, listed ? 'the vehicle of another dealer is listed' : '')
  } else skp('DMS-03', "chassis lookup of another dealer's vehicle", 'needs --other-chassis (a chassis sold by another dealer) and the Captain token')

  // ---- DMS-06 / DMS-08 on the TEST job card only --------------------------------------------------------------------------------------------------------------------
  const tj = args['test-jobcard']
  if (T.captain && tj && !readonly) {
    const form = new FormData()
    form.append('File', new Blob(['<html><body>vapt-marker</body></html>'], { type: 'image/png' }), 'poc.png.html')
    form.append('Stage', 'CheckIn')
    const r = await call('POST', `/api/jobcards/${tj}/photos/upload`, { token: T.captain, form })
    if (r.status >= 200 && r.status < 300) cleanup.push(`DMS-06: the HTML "photo" was ACCEPTED on test job card ${tj} - delete that photo and the file poc.png.html under wwwroot\\uploads`)
    if (r.status === 403 || r.status === 404) skp('DMS-06', 'an HTML file declared as image/png is refused at upload', `inconclusive: HTTP ${r.status} - the dealer scope / the card, not the upload check, refused it. Use an OPEN job card of the Captain login's OWN dealer`)
    else ok('DMS-06', 'an HTML file declared as image/png is refused at upload', r.status === 400 || r.status === 415 || r.status === 422, `got ${r.status} - UploadPhoto still accepts it`)

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
  ok('DMS-12', 'an OTP request for a made-up number does not say "No account found" - it answers the generic message (or HTTP 400 for a badly formed number)',
    !/no account|not found|not registered/i.test(otp.text) && (otp.status === 400 || (otp.status === 200 && !!otp.json && !!otp.json.otpRequestId && /if this number is registered/i.test(String(otp.json.message || '')))), `HTTP ${otp.status}: ${otp.text.slice(0, 140)}`)
  if (args['registered-mobile'] && args['unregistered-mobile']) {
    const timed = async (mobile) => { const t0 = Date.now(); const r = await call('POST', '/api/portal/otp/request', { body: { mobile } }); return { r, ms: Date.now() - t0 } }
    const reg = await timed(String(args['registered-mobile'])); const unreg = await timed(String(args['unregistered-mobile']))
    const keys = (x) => (x.json ? Object.keys(x.json).filter((k) => !/devOtpCode/i.test(k)).sort().join(',') : '')
    ok('DMS-12', 'registered and unregistered number: same status, same fields, same message', reg.r.status === unreg.r.status && keys(reg.r) === keys(unreg.r) && String(reg.r.json && reg.r.json.message) === String(unreg.r.json && unreg.r.json.message),
      `registered HTTP ${reg.r.status} [${keys(reg.r)}] ${reg.r.text.slice(0, 80)} | unregistered HTTP ${unreg.r.status} [${keys(unreg.r)}] ${unreg.r.text.slice(0, 80)}`)
    console.log(`INFO  DMS-12  answer time: registered ${reg.ms} ms, unregistered ${unreg.ms} ms (the API holds both for at least Security:OtpMinResponseMs; a difference of a few hundred ms is network noise)`)
    const vReg = await call('POST', '/api/portal/otp/verify', { body: { otpRequestId: reg.r.json && reg.r.json.otpRequestId, code: '000000', mobile: String(args['registered-mobile']) } })
    const vUnreg = await call('POST', '/api/portal/otp/verify', { body: { otpRequestId: unreg.r.json && unreg.r.json.otpRequestId, code: '000000', mobile: String(args['unregistered-mobile']) } })
    ok('DMS-12', 'a wrong code for a registered number and for an unregistered one answer the same (HTTP 400, same message)', vReg.status === 400 && vUnreg.status === 400 && vReg.text === vUnreg.text, `registered ${vReg.status} ${vReg.text.slice(0, 80)} | unregistered ${vUnreg.status} ${vUnreg.text.slice(0, 80)}`)
  } else skp('DMS-12', 'registered vs unregistered number answers', 'give --registered-mobile (a TEST customer) and --unregistered-mobile')

  const home = await call('GET', '/')
  for (const n of ['x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) ok('DMS-13', `response header ${n} is present`, home.headers.get(n) !== null, 'missing')
  ok('DMS-13', 'Content-Security-Policy (or its report-only form) is present', home.headers.get('content-security-policy') !== null || home.headers.get('content-security-policy-report-only') !== null, 'missing')
  if (base.startsWith('https')) ok('DMS-13', 'Strict-Transport-Security is present', home.headers.get('strict-transport-security') !== null, 'missing')
  ok('DMS-13', 'X-Powered-By is absent', home.headers.get('x-powered-by') === null, 'still sent (merge the web.config change)')
  ok('DMS-13', 'the Server header does not name IIS', !/iis/i.test(home.headers.get('server') || ''), `Server: ${home.headers.get('server')}`)

  // ---- Low ---------------------------------------------------------------------------------------------------------------------------------------------------------
  if (T.captain) {
    const d = await call('GET', '/api/dealers', { token: T.captain })
    // 2026-10-31 (retest DMS-15, evidence of 30.10.2026: the answer listed every dealer with address, GSTIN and rep code): a dealer login now gets only its own dealer
    const rows = Array.isArray(d.json) ? d.json.length : -1
    ok('DMS-15', "GET /api/dealers returns exactly the caller's own dealer (not every dealer, and not nothing)", rows === 1, `rows returned: ${rows}${rows === 0 ? " - the caller's own dealer is missing from the answer" : ''}`)
    // 2026-10-31 (retest DMS-15): the dealer picker of the job card wizard lists EVERY dealer with mobile / e-mail / contact person
    const bd = await call('GET', '/api/bapl-dms/dealers?q=CUS', { token: T.captain })
    if (bd.status === 200 && Array.isArray(bd.json)) {
      ok('DMS-15', 'GET /api/bapl-dms/dealers lists only the caller\'s own dealer (no other dealer\'s mobile / e-mail / contact person)', bd.json.length <= 1, `rows returned: ${bd.json.length}`)
    } else skp('DMS-15', '/api/bapl-dms/dealers contact fields', `the route answered ${bd.status} for this login`)
  } else skp('DMS-15', '/api/dealers contact fields', 'Captain token not set')
  if (T.captain) {
    const matrix = await call('GET', '/api/menu-access', { token: T.captain })
    const modes = await call('GET', '/api/menu-access/role-modes', { token: T.captain })
    ok('DMS-15', 'the role matrix a Captain / ServiceAdvisor can read (/api/menu-access, /role-modes) does not name SystemAdmin or CorporateAdmin', matrix.status === 200 && modes.status === 200 && !/SystemAdmin|CorporateAdmin/.test(matrix.text + modes.text),
      `HTTP ${matrix.status}/${modes.status}, names found: ${[...new Set((matrix.text + modes.text).match(/SystemAdmin|CorporateAdmin|DealerAdmin/g) || [])].join(', ') || 'none'}`)
  } else skp('DMS-15', 'role matrix of /api/menu-access', 'Captain token not set')

  if (T.captain && tj) {
    const det = await call('GET', `/api/jobcards/${tj}`, { token: T.captain })
    const url = det.json && Array.isArray(det.json.photos) && det.json.photos[0] && det.json.photos[0].url
    if (det.status !== 200) skp('DMS-14', 'photo addresses are signed', `GET /api/jobcards/${tj} answered HTTP ${det.status} - this Captain login cannot read that card (it belongs to another dealer, or the id is wrong). Use a job card of the Captain login's OWN dealer`)
    else if (!url) skp('DMS-14', 'photo addresses are signed', 'the test job card has no photo - upload one in the app first')
    else {
      ok('DMS-14', 'the API returns the photo address with an expiring signature (?exp=&sig=)', /[?&]sig=/.test(url) && /[?&]exp=/.test(url), url.split('?')[0])
      const plain = await call('GET', url.split('?')[0])
      ok('DMS-14', 'the same photo WITHOUT a signature and without a login is not served', plain.status === 404 || isDenied(plain.status), `got ${plain.status}`)
      const signed = await call('GET', url)
      ok('DMS-14', 'the signed address works (so the app still shows the photo)', signed.status === 200, `got ${signed.status}`)
    }
  } else skp('DMS-14', 'photo addresses are signed', 'needs --test-jobcard and the Captain token')

  if (T.captain && !readonly) {
    const rn = await call('POST', '/api/session/renew', { token: T.captain })
    if (rn.status === 400) skp('DMS-16', 'silent renewal of a Dealer / Workshop token', 'the Captain token is a Microsoft session - MSAL renews that one itself; use a Dealer / Workshop login token')
    else {
      const fresh = rn.json && rn.json.accessToken
      let expSec = null
      try { expSec = fresh ? JSON.parse(Buffer.from(String(fresh).split('.')[1], 'base64url').toString('utf8')).exp : null } catch { /* unreadable */ }
      ok('DMS-16', 'POST /api/session/renew answers a new token that lives at most about an hour', rn.status === 200 && !!fresh && expSec !== null && expSec - Date.now() / 1000 <= 3660 && expSec - Date.now() / 1000 > 0, `HTTP ${rn.status}${expSec ? `, expires in ${Math.round(expSec - Date.now() / 1000)} s` : ''}`)
      if (fresh) { const me2 = await call('GET', '/api/auth/me', { token: fresh }); ok('DMS-16', 'the renewed token is accepted', me2.status === 200, `/api/auth/me ${me2.status}`) }
    }
  } else if (T.captain) skp('DMS-16', 'silent renewal', '--readonly')

  if (T.captain && !readonly && !args['keep-session']) {
    const out = await call('POST', '/api/session/logout', { token: T.captain })
    const me = await call('GET', '/api/auth/me', { token: T.captain })
    ok('DMS-16', 'after sign-out the same token is refused (HTTP 401)', (out.status === 204 || out.status === 200) && me.status === 401, `logout ${out.status}, then /api/auth/me ${me.status}`)
  } else skp('DMS-16', 'token refused after sign-out', readonly ? '--readonly' : args['keep-session'] ? '--keep-session' : 'Captain token not set')

  console.log(`\nResult: ${pass} passed, ${fail} failed, ${skip} skipped.`)
  if (cleanup.length) { console.log('\nCLEANUP NEEDED (a fix is not working and the server accepted a test request):'); cleanup.forEach((c) => console.log('  - ' + c)) }
  console.log('\nStill manual (cannot be checked from outside): DMS-16 - change a test user\'s role or password in Admin: Users and watch that user\'s open session end (HTTP 401) within about 30 seconds; the Android build has allowBackup=false and no cleartext (decompile or `adb shell dumpsys package com.bgauss.jobcardscanner | findstr /i backup`).')
  process.exit(fail ? 1 : 0)
})()
