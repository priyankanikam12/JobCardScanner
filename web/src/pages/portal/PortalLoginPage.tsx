import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { portalApi } from '../../api/client'
import { useCustomerAuth } from '../../auth/CustomerAuthContext'

export function PortalLoginPage() {
  const { signIn } = useCustomerAuth()
  const navigate = useNavigate()
  const [mobile, setMobile] = useState('')
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
  const [devOtpCode, setDevOtpCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const requestOtp = async () => {
    setError(null)
    try {
      const { data } = await portalApi.post('/api/portal/otp/request', { mobile })
      setOtpRequestId(data.otpRequestId)
      // Only set when the API is running in Development - see OtpService. No real SMS provider is
      // wired up yet, so this is the only way to actually get the code during local testing.
      setDevOtpCode(data.devOtpCode ?? null)
    } catch {
      setError('No account found for this mobile number.')
    }
  }

  const verify = async () => {
    setError(null)
    try {
      const { data } = await portalApi.post('/api/portal/otp/verify', { otpRequestId, code, mobile })
      signIn({ accessToken: data.accessToken, customerId: data.customerId, name: data.name })
      navigate('/portal/jobcards')
    } catch {
      setError('Invalid or expired OTP.')
    }
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <h1 style={{ marginBottom: 4 }}>Track Your Service</h1>
        <p className="muted" style={{ marginBottom: 20 }}>Sign in with your registered mobile number</p>

        {!otpRequestId ? (
          <>
            <div className="field"><input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile number" /></div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!mobile} onClick={requestOtp}>Send OTP</button>
          </>
        ) : (
          <>
            {devOtpCode && (
              <p className="muted" style={{ marginBottom: 8 }}>
                Dev mode (no SMS provider configured) &mdash; OTP code: <strong>{devOtpCode}</strong>
              </p>
            )}
            <div className="field"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit OTP" /></div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!code} onClick={verify}>Verify & Sign In</button>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
