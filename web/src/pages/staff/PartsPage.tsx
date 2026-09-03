import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import type { BaplDmsPartStock, PartMaster } from '../../types'

interface PartsSearchResponse {
  localParts: PartMaster[]
  dmsParts: BaplDmsPartStock[]
  dmsWarning: string | null
}

export function PartsPage() {
  const [q, setQ] = useState('')
  const [locationCode, setLocationCode] = useState('')
  const [localParts, setLocalParts] = useState<PartMaster[]>([])
  const [dmsParts, setDmsParts] = useState<BaplDmsPartStock[]>([])
  const [dmsWarning, setDmsWarning] = useState<string | null>(null)
  const [jobCardId, setJobCardId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const search = () =>
    staffApi
      .get<PartsSearchResponse>('/api/parts', { params: { q: q || undefined, locationCode: locationCode || undefined } })
      .then((r) => {
        setLocalParts(r.data.localParts)
        setDmsParts(r.data.dmsParts)
        setDmsWarning(r.data.dmsWarning)
      })

  useEffect(() => { search() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Item 11: search-as-you-type (debounced) instead of requiring Enter/the Search button - the
  // backend (/api/parts?q=) already does a case-insensitive substring match on name/part
  // number/category and, when locationCode is set, on the BAPL DMS item code too.
  useEffect(() => {
    const handle = setTimeout(search, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, locationCode])

  const request = async (partId: string) => {
    if (!jobCardId) { setMsg('Enter a Job Card ID first (from the job card detail page URL).'); return }
    setMsg(null)
    try {
      await staffApi.post(`/api/jobcards/${jobCardId}/parts`, { partId, quantity: 1 })
      setMsg('Part requested against job card.')
    } catch {
      setMsg('Could not request part - check the Job Card ID.')
    }
  }

  return (
    <div>
      <h2>Parts & Inventory</h2>
      <div className="card">
        <div className="form-row">
          <div className="field"><label>Search catalog</label><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Part name or number" /></div>
          <div className="field">
            <label>BAPL DMS workshop location code (optional)</label>
            <input value={locationCode} onChange={(e) => setLocationCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="e.g. CUS0435W1" />
          </div>
          <div className="field"><label>Target Job Card ID (to request a part against)</label><input value={jobCardId} onChange={(e) => setJobCardId(e.target.value)} placeholder="paste from job card URL" /></div>
        </div>
        <button className="btn" onClick={search}>Search</button>
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Part #</th><th>Name</th><th>Category</th><th>Unit Price</th><th>Stock</th><th></th></tr></thead>
          <tbody>
            {localParts.map((p) => (
              <tr key={p.id}>
                <td>{p.partNumber}</td><td>{p.name}</td><td>{p.category}</td><td>Rs.{p.unitPrice}</td>
                <td>{p.stockQty <= 5 ? <span className="badge badge-danger">{p.stockQty} low</span> : p.stockQty}</td>
                <td><button className="btn btn-sm" onClick={() => request(p.id)}>Request</button></td>
              </tr>
            ))}
            {localParts.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 16 }}>No matches in JobCardScanner's own catalog.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>BAPL DMS Parts Inventory</h3>
        <p className="muted">
          Live stock from BAPL DMS at the location code above. These items aren't in JobCardScanner's
          own catalog (no name/price on file) and can't be requested against a job card here - use
          the "Part Suggestion" panel on a specific job card's Detail page for that instead.
        </p>
        {!locationCode && <p className="muted">Enter a BAPL DMS workshop location code above to see its live stock.</p>}
        {dmsWarning && <p className="muted" style={{ color: '#b91c1c' }}>{dmsWarning}</p>}
        {locationCode && (
          <table>
            <thead><tr><th>Item Code</th><th>Available Qty</th></tr></thead>
            <tbody>
              {dmsParts.map((p) => (
                <tr key={p.itemCode}>
                  <td>{p.itemCode}</td>
                  <td>{p.availableQty}</td>
                </tr>
              ))}
              {dmsParts.length === 0 && !dmsWarning && (
                <tr><td colSpan={2} className="muted" style={{ textAlign: 'center', padding: 16 }}>No stock found at "{locationCode}"{q ? ` matching "${q}"` : ''}.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

