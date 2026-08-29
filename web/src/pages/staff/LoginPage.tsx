import { useState, type FormEvent } from 'react'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { apiLoginRequest } from '../../auth/msalConfig'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { dealerLogin, forgotDealerPassword, resetDealerPassword } from '../../services/dealerAuthService'
import bgaussLogo from '../../assets/BGauss_Logo.png'
import scootyImg from '../../assets/Bg0-scooty.png'
import './LoginPage.css'

type Mode = 'staff' | 'dealer'
type DealerStep = 'login' | 'forgot' | 'reset'

export function LoginPage() {
  const { instance } = useMsal()
  const isMsalAuthenticated = useIsAuthenticated()
  const { isAuthenticated: isStaffAuthenticated, refresh } = useStaffAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('dealer')
  const [step, setStep] = useState<DealerStep>('login')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [devResetToken, setDevResetToken] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Already signed in via either path -> straight to the dashboard.
  if (isMsalAuthenticated || isStaffAuthenticated) return <Navigate to="/dashboard" replace />

  const handleDealerLogin = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await dealerLogin(email, password)
      await refresh()
      if (result.mustChangePassword) {
        setInfo('Signed in. Please set a new password from your profile before continuing - this is your first sign-in.')
      }
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Invalid email or password.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setDevResetToken(null)
    setSubmitting(true)
    try {
      const result = await forgotDealerPassword(email)
      setInfo(result.message)
      if (result.devResetToken) {
        // Local/dev-only convenience: no email provider is wired up yet (see
        // DealerAuthController.ForgotPassword), so the API hands back the raw token itself
        // when running in Development so the flow can be tested end to end.
        setDevResetToken(result.devResetToken)
        setResetToken(result.devResetToken)
      }
      setStep('reset')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await resetDealerPassword(email, resetToken, newPassword)
      setInfo('Password updated. You can sign in now.')
      setStep('login')
      setPassword('')
      setNewPassword('')
      setResetToken('')
      setDevResetToken(null)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'That reset link is invalid or has expired.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="jcs-login-screen">
      <div className="jcs-login-hero">
        <img src={bgaussLogo} alt="BGauss" className="jcs-hero-logo" />
        <h2>EV Two-Wheeler Workshop Management</h2>
        {/* <p>Job cards, estimates, parts, invoicing and reporting for every BGauss service workshop - in one place.</p> */}
        <img src={scootyImg} alt="" aria-hidden="true" className="jcs-hero-scooter" />
      </div>

      <div className="jcs-login-panel">
        <div className="jcs-login-card">
          <div className="jcs-brand-mobile">
            <img src={bgaussLogo} alt="BGauss" />
            <span>JobCardScanner</span>
          </div>

          <div className="jcs-tabs">
            <button
              type="button"
              className={mode === 'dealer' ? 'jcs-tab active' : 'jcs-tab'}
              onClick={() => {
                setMode('dealer')
                setError(null)
                setInfo(null)
              }}
            >
              Dealer / Workshop Login
            </button>
            <button
              type="button"
              className={mode === 'staff' ? 'jcs-tab active' : 'jcs-tab'}
              onClick={() => {
                setMode('staff')
                setError(null)
                setInfo(null)
              }}
            >
              Staff (Microsoft)
            </button>
          </div>

          {mode === 'staff' ? (
            <div className="jcs-mode-body">
              <p className="jcs-mode-copy">
                For BGauss corporate &amp; system admins signing in with their <strong>@bgauss.com</strong> Microsoft account.
              </p>
              <button
                type="button"
                className="jcs-ms-btn"
                onClick={() => instance.loginRedirect(apiLoginRequest)}
              >
                <MicrosoftLogo />
                Continue with Microsoft
              </button>
            </div>
          ) : (
            <div className="jcs-mode-body">
              {step === 'login' && (
                <form onSubmit={handleDealerLogin}>
                  <p className="jcs-mode-copy">For dealer workshop staff signing in with the email &amp; password issued by your admin.</p>
                  <label className="jcs-field">
                    <span>Email</span>
                    <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealer.com" />
                  </label>
                  <label className="jcs-field">
                    <span>Password</span>
                    <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                  </label>
                  <button type="submit" className="btn btn-primary jcs-submit" disabled={submitting}>
                    {submitting ? 'Signing in…' : 'Sign in'}
                  </button>
                  <button
                    type="button"
                    className="jcs-link-btn"
                    onClick={() => {
                      setError(null)
                      setInfo(null)
                      setStep('forgot')
                    }}
                  >
                    Forgot password?
                  </button>
                </form>
              )}

              {step === 'forgot' && (
                <form onSubmit={handleForgotPassword}>
                  <p className="jcs-mode-copy">Enter your email and we'll send you a link to reset your password.</p>
                  <label className="jcs-field">
                    <span>Email</span>
                    <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealer.com" />
                  </label>
                  <button type="submit" className="btn btn-primary jcs-submit" disabled={submitting}>
                    {submitting ? 'Sending…' : 'Send reset link'}
                  </button>
                  <button type="button" className="jcs-link-btn" onClick={() => setStep('login')}>
                    Back to sign in
                  </button>
                </form>
              )}

              {step === 'reset' && (
                <form onSubmit={handleResetPassword}>
                  <p className="jcs-mode-copy">Enter the reset token and choose a new password.</p>
                  {devResetToken && (
                    <p className="jcs-dev-note">
                      Dev mode: no email provider is configured yet, so here's the token directly - <code>{devResetToken}</code>
                    </p>
                  )}
                  <label className="jcs-field">
                    <span>Reset token</span>
                    <input required value={resetToken} onChange={(e) => setResetToken(e.target.value)} placeholder="Paste the token from your email" />
                  </label>
                  <label className="jcs-field">
                    <span>New password</span>
                    <input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
                  </label>
                  <button type="submit" className="btn btn-primary jcs-submit" disabled={submitting}>
                    {submitting ? 'Updating…' : 'Reset password'}
                  </button>
                  <button type="button" className="jcs-link-btn" onClick={() => setStep('login')}>
                    Back to sign in
                  </button>
                </form>
              )}

              {error && <p className="error-text">{error}</p>}
              {info && !error && <p className="jcs-info-text">{info}</p>}
            </div>
          )}

          <p className="muted jcs-portal-hint">
            Customers should use their tracking link or <Link to="/portal/login">the customer portal</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}