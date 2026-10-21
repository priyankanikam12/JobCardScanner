// web\src\components\CareDeskTicketsCard.tsx
import { useEffect, useState } from 'react'
import { staffApi } from '../api/client'
import { CARE_DESK_URL, openCareDesk } from '../lib/careDesk'

/**
 * 2026-10-20: the "Care Desk tickets" card - the tickets BGauss Care Desk holds for ONE vehicle, read through GET /api/care-desk/tickets?vin=... (CareDeskController -> CareDeskService -> the CareDesk database on
 * SQL Server, read-only). CorporateAdmin / SystemAdmin only (the server checks the same policy). Used on the Job Card page and on the Care Desk page's "Find tickets for a vehicle" search.
 * Shows nothing while the server side is not set up (CareDesk:Enabled = true and ConnectionStrings:CareDeskDb) or there is no chassis no.; a failed read says so in one line.
 * TICKET_PAGES_READY: a ticket number becomes a link into the Care Desk app only once the Care Desk ticket screens run on SQL Server (phase 2). Until then it is plain text - the Care Desk app signs you in but has no ticket pages yet.
 */
const TICKET_PAGES_READY = false

interface CareDeskTicket {
  ticketNo: string
  category: string
  status: string
  level: string
  customerName: string
  vin: string
  regNo?: string | null
  description?: string | null
  createdAt: string
  levelDueAt?: string | null
  closedAt?: string | null
  isRepeat: boolean
  open: boolean
}

interface TicketsReply { configured: boolean; message?: string; tickets: CareDeskTicket[] }

const words = (s: string) => s.replace(/_/g, ' ')
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—')

export function CareDeskTicketsCard({ vin }: { vin?: string | null }) {
  const [reply, setReply] = useState<TicketsReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setReply(null)
    setError(null)
    if (!vin) return
    let cancelled = false
    setLoading(true)
    staffApi.get<TicketsReply>('/api/care-desk/tickets', { params: { vin } })
      .then(({ data }) => { if (!cancelled) setReply(data) })
      .catch((err) => {
        if (cancelled) return
        const e = err as { response?: { status?: number; data?: { message?: string } } }
        setError(e?.response?.data?.message ?? (e?.response?.status ? `Could not read the Care Desk tickets (HTTP ${e.response.status}).` : 'Could not read the Care Desk tickets.'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [vin])

  if (!vin) return null

  return (
    <div className="card" id="care-desk-tickets">
      <h3>🎧 Care Desk tickets for {vin}</h3>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error-text">{error}</p>}
      {reply && !reply.configured && (
        <p className="muted">{reply.message ?? 'Care Desk is not set up on the server (CareDesk:Enabled and ConnectionStrings:CareDeskDb).'}</p>
      )}
      {reply && reply.configured && reply.tickets.length === 0 && <p className="muted">No Care Desk ticket for this chassis.</p>}
      {reply && reply.configured && reply.tickets.length > 0 && (
        <table>
          <thead>
            <tr><th>Ticket</th><th>Type</th><th>Status</th><th>Level</th><th>Raised</th><th>Level due</th><th>Closed</th></tr>
          </thead>
          <tbody>
            {reply.tickets.map((t) => (
              <tr key={t.ticketNo}>
                <td>
                  {TICKET_PAGES_READY && CARE_DESK_URL
                    ? <a href="#" onClick={(e) => { e.preventDefault(); void openCareDesk(`/field/tickets/${encodeURIComponent(t.ticketNo)}`) }}>{t.ticketNo} ↗</a>
                    : t.ticketNo}
                  {t.isRepeat && <span className="muted"> · repeat</span>}
                </td>
                <td>{words(t.category)}</td>
                <td>{words(t.status)}{t.open ? '' : ' ✓'}</td>
                <td>{t.level}</td>
                <td>{day(t.createdAt)}</td>
                <td>{t.open ? day(t.levelDueAt) : '—'}</td>
                <td>{day(t.closedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
