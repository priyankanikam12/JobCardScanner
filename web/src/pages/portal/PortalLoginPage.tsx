import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { portalApi } from '../../api/client'
import { useCustomerAuth } from '../../auth/CustomerAuthContext'
import { PasswordInput } from '../../components/PasswordInput'
// Reuses the staff login screen's tab/link/info-box styles (.jcs-tabs, .jcs-tab, .jcs-link-btn,
// .jcs-info-text) for the new OTP/Password mode switcher below - not staff-specific despite the
// file name, just where those classes were first defined.
import '../staff/LoginPage.css'

type Mode = 'otp' | 'password'
type PasswordStep = 'login' | 'forgot' | 'reset'

export function PortalLoginPage() {
  const { signIn } = useCustomerAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('otp')

  // ---------------- OTP (unchanged - existing customers with no password keep using this) ----------------
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

  // ---------------- Password (new, alongside OTP - see CustomerPortalController.Login) ----------------
  const [pwStep, setPwStep] = useState<PasswordStep>('login')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [devResetToken, setDevResetToken] = useState<string | null>(null)
  const [pwInfo, setPwInfo] = useState<string | null>(null)
  const [pwSubmitting, setPwSubmitting] = useState(false)

  const passwordLogin = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPwSubmitting(true)
    try {
      const { data } = await portalApi.post('/api/portal/login', { mobileOrEmail: identifier, password })
      signIn({ accessToken: data.accessToken, customerId: data.customerId, name: data.name })
      navigate('/portal/jobcards')
    } catch (err: unknown) {
      const response = (err as { response?: { data?: { message?: string; passwordNotSet?: boolean } } })?.response
      setError(response?.data?.message ?? 'Invalid mobile/email or password.')
      // "Password login isn't set up yet" - send them straight to Forgot Password, which doubles
      // as "set my first password" (see CustomerPortalController.ResetPassword's doc comment).
      if (response?.data?.passwordNotSet) setPwStep('forgot')
    } finally {
      setPwSubmitting(false)
    }
  }

  const forgotPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPwInfo(null)
    setDevResetToken(null)
    setPwSubmitting(true)
    try {
      const { data } = await portalApi.post('/api/portal/forgot-password', { mobileOrEmail: identifier })
      setPwInfo(data.message)
      if (data.devResetToken) {
        setDevResetToken(data.devResetToken)
        setResetToken(data.devResetToken)
      }
      setPwStep('reset')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPwSubmitting(false)
    }
  }

  const resetPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setPwSubmitting(true)
    try {
      await portalApi.post('/api/portal/reset-password', { mobileOrEmail: identifier, token: resetToken, newPassword })
      setPwInfo('Password set. You can sign in now.')
      setPwStep('login')
      setPassword('')
      setNewPassword('')
      setResetToken('')
      setDevResetToken(null)
    } catch (err: unknown) {
      setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'That reset link is invalid or has expired.')
    } finally {
      setPwSubmitting(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="login-card">
        <h1 style={{ marginBottom: 4 }}>Track Your Service</h1>

        <div className="jcs-tabs" style={{ marginBottom: 16 }}>
          <button type="button" className={mode === 'otp' ? 'jcs-tab active' : 'jcs-tab'} onClick={() => { setMode('otp'); setError(null); setPwInfo(null) }}>
            Mobile OTP
          </button>
          <button type="button" className={mode === 'password' ? 'jcs-tab active' : 'jcs-tab'} onClick={() => { setMode('password'); setError(null) }}>
            Email/Mobile & Password
          </button>
        </div>

        {mode === 'otp' ? (
          <>
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
          </>
        ) : (
          <>
            {pwStep === 'login' && (
              <form onSubmit={passwordLogin}>
                <p className="muted" style={{ marginBottom: 16 }}>Sign in with the mobile number or email your dealer has on file</p>
                <div className="field"><input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Mobile number or email" /></div>
                <div className="field"><PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" /></div>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} type="submit" disabled={pwSubmitting}>
                  {pwSubmitting ? 'Signing in…' : 'Sign in'}
                </button>
                <button type="button" className="jcs-link-btn" onClick={() => { setError(null); setPwInfo(null); setPwStep('forgot') }}>
                  Forgot password / first time signing in?
                </button>
              </form>
            )}
            {pwStep === 'forgot' && (
              <form onSubmit={forgotPassword}>
                <p className="muted" style={{ marginBottom: 16 }}>Enter your mobile number or email and we'll send you a link to set your password.</p>
                <div className="field"><input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Mobile number or email" /></div>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} type="submit" disabled={pwSubmitting}>
                  {pwSubmitting ? 'Sending…' : 'Send reset link'}
                </button>
                <button type="button" className="jcs-link-btn" onClick={() => setPwStep('login')}>Back to sign in</button>
              </form>
            )}
            {pwStep === 'reset' && (
              <form onSubmit={resetPassword}>
                <p className="muted" style={{ marginBottom: 16 }}>Enter the reset token and choose a password.</p>
                {devResetToken && (
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Dev mode: no SMS/email provider is configured yet - here's the token directly: <code>{devResetToken}</code>
                  </p>
                )}
                <div className="field"><input required value={resetToken} onChange={(e) => setResetToken(e.target.value)} placeholder="Paste the token from your SMS/email" /></div>
                <div className="field"><PasswordInput required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" /></div>
                <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} type="submit" disabled={pwSubmitting}>
                  {pwSubmitting ? 'Saving…' : 'Set password'}
                </button>
                <button type="button" className="jcs-link-btn" onClick={() => setPwStep('login')}>Back to sign in</button>
              </form>
            )}
            {pwInfo && !error && <p className="jcs-info-text">{pwInfo}</p>}
          </>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
