interface Props {
  onExcel: () => void
  onPdf: () => void
  disabled?: boolean
}

/**
 * "Download Report" Excel/PDF button pair - 2026-09-18: "vehicle sale . material transfer, repair
 * bill shown download report excel pdf download button insert in starting row download report in
 * all page". Shared across the DMSBAPLDATA-backed list pages (Vehicle Sale, Material Transfer,
 * Repair Bill) so the placement/labels/styling stay identical everywhere it's used - see
 * lib/exportReport.ts for what actually builds the files (client-side, from whatever rows are
 * currently loaded on screen).
 */
export function ReportDownloadButtons({ onExcel, onPdf, disabled }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" className="btn btn-sm btn-excel" onClick={onExcel} disabled={disabled}>⬇ Download Excel</button>
      <button type="button" className="btn btn-sm btn-pdf" onClick={onPdf} disabled={disabled}>⬇ Download PDF</button>
    </div>
  )
}
