import { useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { useIsAuthenticated, useMsal } from '@azure/msal-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { apiLoginRequest } from '../../auth/msalConfig'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import { dealerLogin, forgotDealerPassword, resetDealerPassword } from '../../services/dealerAuthService'
import { PasswordInput } from '../../components/PasswordInput'
import bgaussLogo from '../../assets/BGauss_Logo.png'
// 2026-11-25 ("add 3d ui for login page and replace that scooty with attached scooty"): the single scooter picture is replaced by the BGauss range line-up (Oowah Max, Oowah, RUV350, C12 Max R, BG Max) -
// web/src/assets/BGauss_Lineup.png, a transparent, web-sized copy of the supplied picture. The old Bg0-scooty.png is no longer used here (it can stay in the folder or be deleted).
import lineupImg from '../../assets/BGauss_Lineup.png'
import './LoginPage.css'

type Mode = 'staff' | 'dealer'
type DealerStep = 'login' | 'forgot' | 'reset'

// "Remember me" keeps only the USERNAME in this browser (never the password) - wrapped in try/catch because storage can be blocked (private window, site data cleared).
const REMEMBER_KEY = 'jcs_remember_username'
const readRememberedUsername = (): string => { try { return localStorage.getItem(REMEMBER_KEY) ?? '' } catch { return '' } }
const writeRememberedUsername = (value: string | null) => { try { if (value) localStorage.setItem(REMEMBER_KEY, value); else localStorage.removeItem(REMEMBER_KEY) } catch { /* storage not available - ignore */ } }

export function LoginPage() {
  const { instance } = useMsal()
  const isMsalAuthenticated = useIsAuthenticated()
  const { isAuthenticated: isStaffAuthenticated, refresh } = useStaffAuth()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('dealer')
  const [step, setStep] = useState<DealerStep>('login')

  const [email, setEmail] = useState(readRememberedUsername)
  const [rememberMe, setRememberMe] = useState(() => !!readRememberedUsername())
  const [password, setPassword] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [devResetToken, setDevResetToken] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // 3D effect (2026-11-25): the pointer position over the hero / sign-in panel is written into CSS variables (--tilt-x / --tilt-y, each -0.5 .. 0.5) and LoginPage.css turns them into a gentle
  // rotation of the scooter stage and of the sign-in card. Only style properties are touched - no React state - so moving the mouse never re-renders the form.
  const heroRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const trackPointer = (el: HTMLDivElement | null, e: MouseEvent<HTMLDivElement>) => {
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--tilt-x', ((e.clientX - r.left) / r.width - 0.5).toFixed(3))
    el.style.setProperty('--tilt-y', ((e.clientY - r.top) / r.height - 0.5).toFixed(3))
  }
  const resetPointer = (el: HTMLDivElement | null) => {
    if (!el) return
    el.style.setProperty('--tilt-x', '0')
    el.style.setProperty('--tilt-y', '0')
  }

  // Already signed in via either path -> straight to the dashboard.
  if (isMsalAuthenticated || isStaffAuthenticated) return <Navigate to="/dashboard" replace />

  const handleDealerLogin = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await dealerLogin(email, password)
      writeRememberedUsername(rememberMe ? email.trim() : null)
      await refresh()
      // If this account's mustChangePassword flag is set, RequireStaff (guarding /dashboard)
      // redirects to /change-password itself before rendering anything else - no branching
      // needed here, just go to the normal destination and let the guard decide.
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
      <div
        className="jcs-login-hero"
        ref={heroRef}
        onMouseMove={(e) => trackPointer(heroRef.current, e)}
        onMouseLeave={() => resetPointer(heroRef.current)}
      >
        {/* decoration only: glowing orbit rings and floating lightning badges around the showroom */}
        <span className="jcs-ring jcs-ring-a" aria-hidden="true" />
        <span className="jcs-ring jcs-ring-b" aria-hidden="true" />
        <span className="jcs-ring jcs-ring-c" aria-hidden="true" />
        <span className="jcs-bolt-badge jcs-bolt-a" aria-hidden="true"><BoltIcon /></span>
        <span className="jcs-bolt-badge jcs-bolt-b" aria-hidden="true"><BoltIcon /></span>

        <div className="jcs-hero-head">
          <img src={bgaussLogo} alt="BGauss" className="jcs-hero-logo" />
          <h2>Dealer Management System</h2>
        </div>

        {/* 3D showroom: a perspective grid floor, a green light pool, the line-up standing on it and its mirror reflection. The stage turns a few degrees with the pointer. */}
        <div className="jcs-hero-stage" aria-hidden="true">
          <div className="jcs-hero-floor" />
          <div className="jcs-hero-pool" />
          <div className="jcs-hero-lineup">
            <img src={lineupImg} alt="" className="jcs-hero-scooter" draggable={false} />
            <img src={lineupImg} alt="" className="jcs-hero-reflection" draggable={false} />
          </div>
        </div>
      </div>

      <div
        className="jcs-login-panel"
        ref={panelRef}
        onMouseMove={(e) => trackPointer(panelRef.current, e)}
        onMouseLeave={() => resetPointer(panelRef.current)}
      >
        <div className="jcs-login-card">
          <div className="jcs-card-bar" aria-hidden="true" />
          <div className="jcs-card-head">
            <span className="jcs-card-icon" aria-hidden="true"><BoltIcon /></span>
            <div>
              <h1>Welcome back</h1>
              <p>Sign in to continue.</p>
            </div>
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
                onClick={() => {
                  // On a plain-HTTP deployment (no Web Crypto `subtle` API - see main.tsx's
                  // bootstrap() comment) this throws instead of redirecting. Catch it here so
                  // the click gives a clear on-page message instead of an uncaught console error
                  // with no visible feedback.
                  instance.loginRedirect(apiLoginRequest).catch(() => {
                    setError('Microsoft sign-in needs this site running over HTTPS - use the Dealer / Workshop tab for now.')
                  })
                }}
              >
                <MicrosoftLogo />
                Continue with Microsoft
              </button>
            </div>
          ) : (
            <div className="jcs-mode-body">
              {step === 'login' && (
                <form onSubmit={handleDealerLogin}>
                  <label className="jcs-field">
                    <span>Username</span>
                    {/* Plain text, not type="email" - a DMS login can be signed in with a
                       bare dealer code as its username (e.g. "CUS0486"), same as DMS's own
                       site accepts (see DealerAuthController.Login's fallback to
                       BaplDmsService.VerifyDealerCredentialsAsync) - the browser's built-in email
                       format validation would otherwise silently block submitting that. */}
                    <InputWithIcon icon={<UserIcon />}>
                      <input type="text" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealer.com or CUS0001" />
                    </InputWithIcon>
                  </label>
                  <div className="jcs-field">
                    <div className="jcs-field-row">
                      <span>Password</span>
                      <button
                        type="button"
                        className="jcs-forgot"
                        onClick={() => {
                          setError(null)
                          setInfo(null)
                          setStep('forgot')
                        }}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <InputWithIcon icon={<LockIcon />}>
                      <PasswordInput required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                    </InputWithIcon>
                  </div>
                  <label className="jcs-remember">
                    <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                    <span>Remember me</span>
                  </label>
                  <button type="submit" className="btn btn-primary jcs-submit" disabled={submitting}>
                    {submitting ? 'Signing in…' : <>Sign In <ArrowIcon /></>}
                  </button>
                </form>
              )}

              {step === 'forgot' && (
                <form onSubmit={handleForgotPassword}>
                  <p className="jcs-mode-copy">Enter your email and we'll send you a link to reset your password.</p>
                  <label className="jcs-field">
                    <span>Email</span>
                    <InputWithIcon icon={<UserIcon />}>
                      <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@dealer.com" />
                    </InputWithIcon>
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
                    <PasswordInput required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
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

          {/* <p className="muted jcs-portal-hint">
            Customers should use their tracking link or <Link to="/portal/login">the customer portal</Link>.
          </p> */}
        </div>
      </div>
    </div>
  )
}

/** Wraps an input with a leading icon (the input gets left padding from .jcs-input-wrap in LoginPage.css). */
function InputWithIcon({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="jcs-input-wrap">
      <span className="jcs-input-icon" aria-hidden="true">{icon}</span>
      {children}
    </div>
  )
}

const iconProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
function UserIcon() {
  return (<svg {...iconProps}><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c.9-3.6 3.7-5.4 7.5-5.4s6.6 1.8 7.5 5.4" /></svg>)
}
function LockIcon() {
  return (<svg {...iconProps}><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" /></svg>)
}
function ArrowIcon() {
  return (<svg {...iconProps} width={18} height={18} strokeWidth={2.2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>)
}
function BoltIcon() {
  return (<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.4 2 5 13.2h5.6L9.6 22 19 10.2h-5.7L13.4 2Z" /></svg>)
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

