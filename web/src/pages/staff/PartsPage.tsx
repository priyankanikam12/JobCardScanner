import { useEffect, useState } from 'react'
import { staffApi } from '../../api/client'
import type { PartMaster } from '../../types'

export function PartsPage() {
  const [q, setQ] = useState('')
  const [parts, setParts] = useState<PartMaster[]>([])
  const [jobCardId, setJobCardId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const search = () => staffApi.get<PartMaster[]>('/api/parts', { params: { q: q || undefined } }).then((r) => setParts(r.data))

  useEffect(() => { search() }, [])

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
          <div className="field"><label>Target Job Card ID (to request a part against)</label><input value={jobCardId} onChange={(e) => setJobCardId(e.target.value)} placeholder="paste from job card URL" /></div>
        </div>
        <button className="btn" onClick={search}>Search</button>
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Part #</th><th>Name</th><th>Category</th><th>Unit Price</th><th>Stock</th><th></th></tr></thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id}>
                <td>{p.partNumber}</td><td>{p.name}</td><td>{p.category}</td><td>Rs.{p.unitPrice}</td>
                <td>{p.stockQty <= 5 ? <span className="badge badge-danger">{p.stockQty} low</span> : p.stockQty}</td>
                <td><button className="btn btn-sm" onClick={() => request(p.id)}>Request</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
