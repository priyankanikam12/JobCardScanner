// Usage (from the API project folder):  node ../../patches/vapt/apply-program-cs-security.js Program.cs      (or give the real path to your Program.cs)
// 2026-10-17 (VAPT): wires the security layer (Security/*.cs) into Program.cs with six one-line additions. A backup Program.cs.before-vapt is written first.
// Every anchor must be found exactly once; if one is not, NOTHING is changed. Running it twice does nothing.
const fs = require('fs')
const file = process.argv[2]
if (!file) { console.error('Give the path of Program.cs'); process.exit(1) }
let s = fs.readFileSync(file, 'utf8')
if (s.includes('AddAppSecurity()')) { console.log('Already applied.'); process.exit(0) }
const nl = s.includes('\r\n') ? '\r\n' : '\n'

const edits = [
  { find: 'using JobCardScanner.Api.Services.Integrations;', add: `${nl}using JobCardScanner.Api.Security;`, where: 'after' },
  { find: 'var builder = WebApplication.CreateBuilder(args);', add: `${nl}${nl}// 2026-10-17 (VAPT): security layer - Security/*.cs${nl}builder.AddAppSecurity();`, where: 'after' },
  { find: 'var app = builder.Build();', add: `${nl}app.UseAppSecurityEarly();   // 2026-10-17 (VAPT): forwarded headers + security headers (DMS-13)`, where: 'after' },
  { find: 'app.UseCors("AppCors");', add: `${nl}app.UseAppRateLimit();        // 2026-10-17 (VAPT): rate limits + failed-login lockout (DMS-11, DMS-12)`, where: 'after' },
  { find: 'app.UseStaticFiles(new StaticFileOptions { ContentTypeProvider = staticFileProvider });',
    replace: 'app.UseAppStaticFiles(staticFileProvider);   // 2026-10-17 (VAPT DMS-06): /uploads only as safe media types, never HTML' },
  { find: `app.UseAuthorization();${nl}app.MapControllers();`,
    replace: `app.UseAuthorization();${nl}app.UseAppGuards();   // 2026-10-17 (VAPT): route guard + response sanitizer (DMS-01, 02, 04, 05, 09, 10, 12, 15)${nl}app.MapControllers();` },
]
for (const e of edits) {
  const n = s.split(e.find).length - 1
  if (n !== 1) { console.error(`NOT APPLIED - expected exactly 1 match, found ${n} for:\n  ${e.find}`); process.exit(1) }
}
fs.writeFileSync(file + '.before-vapt', s)
for (const e of edits) {
  s = e.replace !== undefined ? s.replace(e.find, () => e.replace) : s.replace(e.find, () => e.find + e.add)
}
fs.writeFileSync(file, s)
console.log(`Program.cs updated (${edits.length} additions). Backup: ${file}.before-vapt`)
