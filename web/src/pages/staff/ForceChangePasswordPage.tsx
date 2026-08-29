// web\src\pages\staff\ForceChangePasswordPage.tsx
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { changeMyPassword } from '../../services/dealerAuthService'
import { clearMustChangePassword } from '../../auth/dealerSession'
import { useStaffAuth } from '../../auth/StaffAuthContext'
import bgaussLogo from '../../assets/BGauss_Logo.png'
import scootyImg from '../../assets/Bg0-scooty.png'
import './LoginPage.css'

/**
 * Forced first-sign-in / post-admin-reset password change for local "Dealer / Workshop Login"
 * accounts. RequireStaff redirects here automatically whenever the signed-in dealer session's
 * mustChangePassword flag is set - notably every account created by Admin -> Users' "Bulk
 * import dealers from ERP" panel starts with the same default password (Dealer@123) shared
 * across every dealer, so this page is what actually forces it to be replaced with something
 * only that dealer knows, rather than leaving mustChangePassword as an unenforced flag.
 */
export function ForceChangePasswordPage() {
  const navigate = useNavigate()
  const { refresh } = useStaffAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setError('Choose a password different from the one you signed in with.')
      return
    }

    setSubmitting(true)
    try {
      await changeMyPassword(currentPassword, newPassword)
      clearMustChangePassword()
      await refresh()
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not change your password. Please try again.'
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
        <p>Job cards, estimates, parts, invoicing and reporting for every BGauss service workshop - in one place.</p>
        <img src={scootyImg} alt="" aria-hidden="true" className="jcs-hero-scooter" />
      </div>

      <div className="jcs-login-panel">
        <div className="jcs-login-card">
          <div className="jcs-brand-mobile">
            <img src={bgaussLogo} alt="BGauss" />
            <span>JobCardScanner</span>
          </div>

          <div className="jcs-mode-body">
            <h2 style={{ marginTop: 0 }}>Set a new password</h2>
            <p className="jcs-mode-copy">
              This is either your first sign-in or your password was just reset by an admin.
              Choose a password only you know before continuing.
            </p>

            <form onSubmit={handleSubmit}>
              <label className="jcs-field">
                <span>Current (temporary) password</span>
                <input type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </label>
              <label className="jcs-field">
                <span>New password</span>
                <input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" />
              </label>
              <label className="jcs-field">
                <span>Confirm new password</span>
                <input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </label>

              <button type="submit" className="btn btn-primary jcs-submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Set password and continue'}
              </button>

              {error && <p className="error-text">{error}</p>}
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
