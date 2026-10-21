// Usage (from the JobCard web project folder, i.e. the one that has src\):
//   node ../patches/care-desk/apply-care-desk-sso-links.js
// 2026-10-19: the two places that linked to Care Desk with a plain address (so Care Desk asked for a login) now go through openCareDesk() (src/lib/careDesk.ts):
//   src/pages/staff/JobCardDetailPage.tsx    "Care Desk tickets for this chassis" -> opens the search for the chassis, signed in
//   src/components/CareDeskTicketsCard.tsx   a ticket number -> opens that ticket, signed in   (also fixes the address: an Admin opens tickets at /field/tickets/<no>, not /desk/tickets/<no>)
// Copy src/lib/careDesk.ts first. Every anchor must be found exactly once per file; running it twice does nothing. Backups: <file>.before-sso-links
const fs = require('fs')
const root = process.argv[2] || '.'
const files = [
  {
    file: 'src/pages/staff/JobCardDetailPage.tsx',
    edits: [
      {
        find: "const CARE_DESK_URL: string = ((import.meta.env.VITE_CARE_DESK_URL as string | undefined) ?? '').trim().replace(/\\/+$/, '')",
        repl: "// (CARE_DESK_URL and openCareDesk come from src/lib/careDesk.ts - the link below signs the person in to Care Desk instead of just opening its address)",
      },
      {
        find: "import { staffApi } from '../../api/client'",
        repl: "import { staffApi } from '../../api/client'\nimport { CARE_DESK_URL, openCareDesk } from '../../lib/careDesk'",
      },
      {
        find: "<a href={`${CARE_DESK_URL}/field/search?q=${encodeURIComponent(jc.vehicle.vin)}`} target=\"_blank\" rel=\"noreferrer\">🎧 Care Desk tickets for this chassis ↗</a>",
        repl: "<a href=\"#\" onClick={(e) => { e.preventDefault(); void openCareDesk(`/field/search?q=${encodeURIComponent(jc.vehicle?.vin ?? '')}`) }}>🎧 Care Desk tickets for this chassis ↗</a>",
      },
    ],
  },
  {
    file: 'src/components/CareDeskTicketsCard.tsx',
    edits: [
      {
        find: "import { staffApi } from '../api/client'",
        repl: "import { staffApi } from '../api/client'\nimport { CARE_DESK_URL, openCareDesk } from '../lib/careDesk'",
      },
      {
        find: "const CARE_DESK_URL: string = ((import.meta.env.VITE_CARE_DESK_URL as string | undefined) ?? '').trim().replace(/\\/+$/, '')",
        repl: "// (CARE_DESK_URL and openCareDesk come from src/lib/careDesk.ts)",
      },
      {
        find: "<a href={`${CARE_DESK_URL}/desk/tickets/${encodeURIComponent(t.ticketNo)}`} target=\"_blank\" rel=\"noreferrer\">{t.ticketNo} ↗</a>",
        repl: "<a href=\"#\" onClick={(e) => { e.preventDefault(); void openCareDesk(`/field/tickets/${encodeURIComponent(t.ticketNo)}`) }}>{t.ticketNo} ↗</a>",
      },
    ],
  },
]
let changed = 0
for (const f of files) {
  const p = `${root}/${f.file}`
  if (!fs.existsSync(p)) { console.error(`MISSING ${p}`); process.exit(1) }
  let s = fs.readFileSync(p, 'utf8')
  if (s.includes("from '../../lib/careDesk'") || s.includes("from '../lib/careDesk'")) { console.log(`already done: ${f.file}`); continue }
  const crlf = s.includes('\r\n')
  if (crlf) s = s.replace(/\r\n/g, '\n')
  for (const e of f.edits) {
    const n = s.split(e.find).length - 1
    if (n !== 1) { console.error(`NOT APPLIED (${f.file}) - expected exactly 1 match, found ${n} for:\n  ${e.find.slice(0, 110)}`); process.exit(1) }
  }
  fs.writeFileSync(`${p}.before-sso-links`, fs.readFileSync(p))
  for (const e of f.edits) s = s.replace(e.find, () => e.repl)
  fs.writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s)
  console.log(`changed: ${f.file}`)
  changed++
}
console.log(changed ? 'Done.' : 'Nothing to change.')
