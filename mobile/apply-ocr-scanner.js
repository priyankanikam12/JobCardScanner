// mobile\apply-ocr-scanner.js
// 2026-11-13: adds the OCR scan button to the "Chassis no. / RegNo." field of src/screens/JobCardWizardScreen.tsx.
// It changes YOUR current file in exactly two places (one import line, one <ChassisScanButton .../> element
// right after the field's TextInput) and touches nothing else. Run from the mobile folder:   node apply-ocr-scanner.js
// Safe: makes a backup first (JobCardWizardScreen.tsx.before-ocr.bak), refuses to run twice, and stops without
// changing anything if the file does not look exactly as expected.
const fs = require('fs')
const path = require('path')

const root = __dirname
const wizard = path.join(root, 'src', 'screens', 'JobCardWizardScreen.tsx')
const need = [path.join(root, 'src', 'components', 'ChassisScanButton.tsx'), path.join(root, 'src', 'utils', 'vehicleIdOcr.ts')]
const stop = (msg) => { console.error('\nNOT CHANGED: ' + msg + '\n'); process.exit(1) }

for (const f of need) if (!fs.existsSync(f)) stop('missing ' + path.relative(root, f) + ' - copy the new files into the mobile folder first.')
if (!fs.existsSync(wizard)) stop('cannot find ' + wizard)

const src = fs.readFileSync(wizard, 'utf8')
if (src.includes('ChassisScanButton')) { console.log('Already applied - nothing to do.'); process.exit(0) }
const eol = src.includes('\r\n') ? '\r\n' : '\n'

const importRe = /^import \{ PickerField, type PickerOption \} from '\.\.\/components\/PickerField'[^\r\n]*/gm
const fieldRe = /^([ \t]*)onSubmitEditing=\{\(\) => lookupByChassisOrReg\(\)\}\r?\n([ \t]*)\/>\r?\n/gm
const importHits = src.match(importRe) || []
const fieldHits = src.match(fieldRe) || []
if (importHits.length !== 1) stop('expected exactly one "import { PickerField ... }" line, found ' + importHits.length + '. Send me the current JobCardWizardScreen.tsx and I will patch it directly.')
if (fieldHits.length !== 1) stop('expected exactly one Chassis/Reg search field ("onSubmitEditing={() => lookupByChassisOrReg()}"), found ' + fieldHits.length + '. Send me the current JobCardWizardScreen.tsx and I will patch it directly.')

let out = src.replace(importRe, (m) => m + eol + "import { ChassisScanButton } from '../components/ChassisScanButton'")
out = out.replace(fieldRe, (m, _a, closeIndent) => m +
  closeIndent + '<ChassisScanButton' + eol +
  closeIndent + '  disabled={vehicleLookupLoading}' + eol +
  closeIndent + '  onResult={(v) => { setChassisOrRegQ(v); lookupByChassisOrReg(v) }}' + eol +
  closeIndent + '/>' + eol)

const backup = wizard + '.before-ocr.bak'
if (!fs.existsSync(backup)) fs.copyFileSync(wizard, backup)
fs.writeFileSync(wizard, out, 'utf8')

const check = fs.readFileSync(wizard, 'utf8')
if (!check.includes("import { ChassisScanButton }") || !check.includes('<ChassisScanButton')) {
  fs.copyFileSync(backup, wizard)
  stop('the check after writing failed; the original file was restored.')
}
console.log('Done. Added the import and the scan button to src/screens/JobCardWizardScreen.tsx (backup: JobCardWizardScreen.tsx.before-ocr.bak).')
console.log('Next:  npm install @react-native-ml-kit/text-recognition@2.0.0   then rebuild the Android app (see README-OCR-SCANNER.md).')