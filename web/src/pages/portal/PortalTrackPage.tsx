import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { portalApi } from '../../api/client'
import { useCustomerAuth } from '../../auth/CustomerAuthContext'
import { WorkflowTimeline } from '../../components/WorkflowTimeline'
import type { WorkflowStage } from '../../types'

interface TrackData {
  id: string
  jobCardNumber: string
  status: string
  stageLabel?: string
  currentStageId?: string | null
  stages: WorkflowStage[]
  vehicleModel?: string
  vehicleRegNo?: string
  expectedDeliveryAt?: string
  timeline: { stageLabel?: string; enteredAt: string; exitedAt?: string }[]
  pendingEstimates: { id: string; estimateNumber: string; totalAmount: number; reason?: string }[]
}

export function PortalTrackPage() {
  const { token } = useParams<{ token: string }>()
  const { session } = useCustomerAuth()
  const [data, setData] = useState<TrackData | null>(null)
  const [activeEstimate, setActiveEstimate] = useState<string | null>(null)
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => portalApi.get<TrackData>(`/api/portal/track/${token}`).then((r) => setData(r.data))
  useEffect(() => { load() }, [token])

  if (!data) return <p className="muted" style={{ textAlign: 'center', marginTop: 60 }}>Loading...</p>

  const startApproval = async (estimateId: string) => {
    setActiveEstimate(estimateId)
    setMsg(null)
    const { data: otp } = await portalApi.post(`/api/estimates/${estimateId}/otp`)
    setOtpRequestId(otp.otpRequestId)
  }

  const respond = async (approve: boolean) => {
    if (!activeEstimate || !otpRequestId) return
    try {
      await portalApi.post(`/api/estimates/${activeEstimate}/${approve ? 'approve' : 'reject'}`, { otpRequestId, code })
      setMsg(approve ? 'Estimate approved. Thank you!' : 'Estimate rejected.')
      setActiveEstimate(null)
      setOtpRequestId(null)
      setCode('')
      load()
    } catch {
      setMsg('Invalid or expired OTP.')
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', padding: '0 20px' }}>
      <h1>{data.jobCardNumber}</h1>
      <p className="muted">{data.vehicleModel} - {data.vehicleRegNo}</p>

      <div className="card">
        <h3>Live Status</h3>
        {data.expectedDeliveryAt && <p className="muted">Expected delivery: {new Date(data.expectedDeliveryAt).toLocaleString()}</p>}
        <WorkflowTimeline stages={data.stages ?? []} currentStageId={data.currentStageId} history={data.timeline} />
      </div>

      {data.pendingEstimates.length > 0 && (
        <div className="card">
          <h3>Additional Work Requiring Your Approval</h3>
          {!session && <p className="muted">Please <Link to="/portal/login">sign in</Link> to approve or reject additional work.</p>}
          {data.pendingEstimates.map((e) => (
            <div key={e.id} style={{ borderBottom: '1px solid #eee', paddingBottom: 12, marginBottom: 12 }}>
              <p><strong>{e.estimateNumber}</strong> - Rs.{e.totalAmount}</p>
              <p className="muted">{e.reason}</p>
              {session && activeEstimate !== e.id && (
                <button className="btn btn-sm btn-primary" onClick={() => startApproval(e.id)}>Review & Approve/Reject</button>
              )}
              {session && activeEstimate === e.id && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="OTP sent to your mobile" value={code} onChange={(ev) => setCode(ev.target.value)} />
                  <button className="btn btn-sm btn-primary" onClick={() => respond(true)}>Approve</button>
                  <button className="btn btn-sm btn-danger" onClick={() => respond(false)}>Reject</button>
                </div>
              )}
            </div>
          ))}
          {msg && <p className="muted">{msg}</p>}
        </div>
      )}
    </div>
  )
}