import { useState } from 'react'
import { staffApi } from '../../api/client'

interface SearchResults {
  jobCards: { id: string; jobCardNumber: string; status: string; customerName: string; vehicleRegNo?: string }[]
  customers: { id: string; name: string; mobile: string }[]
  invoices: { id: string; invoiceNumber: string; totalAmount: number; status: string }[]
}

function downloadBlob(data: BlobPart, filename: string) {
  const url = URL.createObjectURL(new Blob([data]))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ReportsPage() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)

  const search = () => staffApi.get<SearchResults>('/api/search', { params: { q } }).then((r) => setResults(r.data))

  const exportJobCards = async () => {
    const res = await staffApi.get('/api/reports/jobcards/export', { responseType: 'blob' })
    downloadBlob(res.data, 'jobcards-report.xlsx')
  }
  const exportInvoices = async () => {
    const res = await staffApi.get('/api/reports/invoices/export', { responseType: 'blob' })
    downloadBlob(res.data, 'invoices-report.xlsx')
  }

  return (
    <div>
      <h2>Reports & Global Search</h2>

      <div className="card">
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Search job cards, customers, invoices..." />
          <button className="btn btn-primary" onClick={search}>Search</button>
        </div>
      </div>

      {results && (
        <div className="card">
          <h3>Job Cards</h3>
          <ul>{results.jobCards.map((j) => <li key={j.id}>{j.jobCardNumber} - {j.customerName} - {j.status}</li>)}</ul>
          <h3>Customers</h3>
          <ul>{results.customers.map((c) => <li key={c.id}>{c.name} - {c.mobile}</li>)}</ul>
          <h3>Invoices</h3>
          <ul>{results.invoices.map((i) => <li key={i.id}>{i.invoiceNumber} - Rs.{i.totalAmount} - {i.status}</li>)}</ul>
        </div>
      )}

      <div className="card">
        <h3>Export reports</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={exportJobCards}>Export Job Cards (.xlsx)</button>
          <button className="btn" onClick={exportInvoices}>Export Invoices (.xlsx)</button>
        </div>
      </div>
    </div>
  )
}
