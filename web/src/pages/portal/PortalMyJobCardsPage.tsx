import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { portalApi } from '../../api/client'
import { useCustomerAuth } from '../../auth/CustomerAuthContext'
import { StatusBadge } from '../../components/StatusBadge'

interface MyJobCard {
  id: string
  jobCardNumber: string
  status: string
  stageLabel?: string
  vehicleModel?: string
  trackingToken: string
  createdAt: string
}

export function PortalMyJobCardsPage() {
  const { session, signOut } = useCustomerAuth()
  const [jobCards, setJobCards] = useState<MyJobCard[]>([])

  useEffect(() => {
    if (!session) return
    portalApi.get<MyJobCard[]>('/api/portal/me/jobcards').then((r) => setJobCards(r.data))
  }, [session])

  if (!session) return <Navigate to="/portal/login" replace />

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Hi, {session.name}</h1>
        <button className="btn btn-sm" onClick={signOut}>Sign out</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Job Card</th><th>Vehicle</th><th>Stage</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {jobCards.map((j) => (
              <tr key={j.id}>
                <td>{j.jobCardNumber}</td><td>{j.vehicleModel}</td><td>{j.stageLabel}</td><td><StatusBadge status={j.status} /></td>
                <td><Link className="btn btn-sm" to={`/track/${j.trackingToken}`}>Track</Link></td>
              </tr>
            ))}
            {jobCards.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 20 }}>No job cards yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
