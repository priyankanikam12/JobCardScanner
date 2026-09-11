import { useState, type ReactNode } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { dealerLogin, forgotDealerPassword, resetDealerPassword } from '../services/dealerAuthService'
import { PasswordField } from '../components/PasswordField'

type Mode = 'dealer' | 'staff'
type DealerStep = 'login' | 'forgot' | 'reset'

// BGauss brand palette - mirrors web/src/pages/staff/LoginPage.css exactly (navy #0b1220/#101828
// + volt-green #8ef542 accents, the same pair the rest of the staff app's sidebar uses). Web's
// hero panel uses BGauss_Logo.png/Bg0-scooty.png, which this repo checkout doesn't have a copy of
// to bundle into the mobile app - the "BG" monogram badge below stands in for the real logo until
// those PNGs are available to embed; swap BrandBadge's content for an <Image> once they are.
const NAVY = '#0b1220'
const NAVY_CARD = '#101828'
const VOLT = '#8ef542'

/** Mirrors web/src/pages/staff/LoginPage.tsx: two tabs (Dealer/Workshop local login vs Staff
 * Microsoft/Azure AD), with the same forgot/reset-password sub-flow under the Dealer tab, and the
 * same navy-hero-plus-white-card BGauss branding web falls back to on a narrow (mobile-width)
 * screen. Unlike the web version this screen never needs its own "already signed in -> redirect"
 * check - RootNavigator only ever mounts LoginScreen while isAuthenticated is false. */
export function LoginScreen() {
  const { signIn, signingIn, error: azureError } = useAuth()
  const { refresh } = useStaffAuth()

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
  const [focusedField, setFocusedField] = useState<string | null>(null)

  const resetMessages = () => { setError(null); setInfo(null) }

  const handleDealerLogin = async () => {
    resetMessages()
    setSubmitting(true)
    try {
      await dealerLogin(email.trim(), password)
      // Tells StaffAuthContext to re-check SecureStore, which flips isAuthenticated to true and
      // - via RootNavigator - swaps this screen out for either ForceChangePasswordScreen (if this
      // is a first sign-in / admin-reset account) or the main app.
      await refresh()
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Invalid email or password.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleForgotPassword = async () => {
    resetMessages()
    setDevResetToken(null)
    setSubmitting(true)
    try {
      const result = await forgotDealerPassword(email.trim())
      setInfo(result.message)
      if (result.devResetToken) {
        // Dev-only convenience (no SMS/email provider wired up yet) - same as web's LoginPage.
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

  const handleResetPassword = async () => {
    resetMessages()
    setSubmitting(true)
    try {
      await resetDealerPassword(email.trim(), resetToken, newPassword)
      setInfo('Password updated. You can sign in now.')
      setStep('login')
      setPassword('')
      setNewPassword('')
      setResetToken('')
      setDevResetToken(null)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "That reset link is invalid or has expired."
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Soft glow accents standing in for web's radial-gradient hero background, without
           pulling in a gradient library just for this screen. */}
        <View style={styles.glowGreen} pointerEvents="none" />
        <View style={styles.glowBlue} pointerEvents="none" />

        <View style={styles.heroRow}>
          <BrandBadge />
          <Text style={styles.title}>JobCardScanner</Text>
        </View>
        <Text style={styles.subtitle}>EV Two-Wheeler Workshop Management</Text>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, mode === 'dealer' && styles.tabActive]}
              onPress={() => { setMode('dealer'); resetMessages() }}
            >
              <Text style={[styles.tabText, mode === 'dealer' && styles.tabTextActive]}>Dealer / Workshop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, mode === 'staff' && styles.tabActive]}
              onPress={() => { setMode('staff'); resetMessages() }}
            >
              <Text style={[styles.tabText, mode === 'staff' && styles.tabTextActive]}>Staff (Microsoft)</Text>
            </TouchableOpacity>
          </View>

          {mode === 'staff' ? (
            <View>
              <Text style={styles.copy}>
                For BGauss corporate & system admins signing in with their @bgauss.com Microsoft account.
              </Text>
              {signingIn ? (
                <ActivityIndicator size="large" color="#101828" style={{ marginTop: 20 }} />
              ) : (
                <TouchableOpacity style={styles.msButton} onPress={signIn}>
                  <MicrosoftLogo />
                  <Text style={styles.msButtonText}>Continue with Microsoft</Text>
                </TouchableOpacity>
              )}
              {azureError && <Text style={styles.errorText}>{azureError}</Text>}
            </View>
          ) : (
            <View>
              {step === 'login' && (
                <>
                  <Text style={styles.copy}>
                    For dealer workshop staff signing in with the email/dealer code & password issued by your admin, or your DMS login.
                  </Text>
                  <Field label="Email or Dealer Code">
                    <TextInput
                      style={[styles.input, focusedField === 'email' && styles.inputFocused]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={email}
                      onChangeText={setEmail}
                      onFocus={() => setFocusedField('email')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="you@dealer.com or CUS0001"
                      placeholderTextColor="#9ca3af"
                    />
                  </Field>
                  <Field label="Password">
                    <PasswordField
                      style={[styles.input, focusedField === 'password' && styles.inputFocused]}
                      value={password}
                      onChangeText={setPassword}
                      onFocus={() => setFocusedField('password')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="••••••••"
                      placeholderTextColor="#9ca3af"
                    />
                  </Field>
                  <TouchableOpacity
                    style={[styles.submitButton, (!email || !password || submitting) && styles.buttonDisabled]}
                    disabled={!email || !password || submitting}
                    onPress={handleDealerLogin}
                  >
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Sign in</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.linkButton} onPress={() => { setStep('forgot'); resetMessages() }}>
                    <Text style={styles.linkText}>Forgot password?</Text>
                  </TouchableOpacity>
                </>
              )}

              {step === 'forgot' && (
                <>
                  <Text style={styles.copy}>Enter your email and we'll send you a link to reset your password.</Text>
                  <Field label="Email">
                    <TextInput
                      style={[styles.input, focusedField === 'email' && styles.inputFocused]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      value={email}
                      onChangeText={setEmail}
                      onFocus={() => setFocusedField('email')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="you@dealer.com"
                      placeholderTextColor="#9ca3af"
                    />
                  </Field>
                  <TouchableOpacity
                    style={[styles.submitButton, (!email || submitting) && styles.buttonDisabled]}
                    disabled={!email || submitting}
                    onPress={handleForgotPassword}
                  >
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Send reset link</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.linkButton} onPress={() => { setStep('login'); resetMessages() }}>
                    <Text style={styles.linkText}>Back to sign in</Text>
                  </TouchableOpacity>
                </>
              )}

              {step === 'reset' && (
                <>
                  <Text style={styles.copy}>Enter the reset token and choose a new password.</Text>
                  {devResetToken && (
                    <Text style={styles.devNote}>
                      Dev mode: no email provider is configured yet, so here's the token directly - {devResetToken}
                    </Text>
                  )}
                  <Field label="Reset token">
                    <TextInput
                      style={[styles.input, focusedField === 'resetToken' && styles.inputFocused]}
                      value={resetToken}
                      onChangeText={setResetToken}
                      onFocus={() => setFocusedField('resetToken')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="Paste the token from your email"
                      placeholderTextColor="#9ca3af"
                    />
                  </Field>
                  <Field label="New password">
                    <PasswordField
                      style={[styles.input, focusedField === 'newPassword' && styles.inputFocused]}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      onFocus={() => setFocusedField('newPassword')}
                      onBlur={() => setFocusedField(null)}
                      placeholder="At least 8 characters"
                      placeholderTextColor="#9ca3af"
                    />
                  </Field>
                  <TouchableOpacity
                    style={[styles.submitButton, (!resetToken || newPassword.length < 8 || submitting) && styles.buttonDisabled]}
                    disabled={!resetToken || newPassword.length < 8 || submitting}
                    onPress={handleResetPassword}
                  >
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Reset password</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.linkButton} onPress={() => { setStep('login'); resetMessages() }}>
                    <Text style={styles.linkText}>Back to sign in</Text>
                  </TouchableOpacity>
                </>
              )}

              {error && <Text style={styles.errorText}>{error}</Text>}
              {info && !error && <Text style={styles.infoText}>{info}</Text>}
            </View>
          )}

          <Text style={styles.portalHint}>Customers should use the tracking link their workshop sent them.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  )
}

function BrandBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>BG</Text>
    </View>
  )
}

/** Four-color Microsoft "windows" mark, built from plain colored squares - matches web's inline
 * SVG version without needing a react-native-svg dependency just for one static icon. */
function MicrosoftLogo() {
  return (
    <View style={styles.msLogo}>
      <View style={styles.msLogoRow}>
        <View style={[styles.msLogoSquare, { backgroundColor: '#f25022' }]} />
        <View style={[styles.msLogoSquare, { backgroundColor: '#7fba00' }]} />
      </View>
      <View style={styles.msLogoRow}>
        <View style={[styles.msLogoSquare, { backgroundColor: '#00a4ef' }]} />
        <View style={[styles.msLogoSquare, { backgroundColor: '#ffb900' }]} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: NAVY },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 64, paddingBottom: 40 },
  glowGreen: { position: 'absolute', top: -60, left: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(142, 245, 66, 0.14)' },
  glowBlue: { position: 'absolute', bottom: -80, right: -60, width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(37, 99, 235, 0.18)' },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 4 },
  badge: { width: 34, height: 34, borderRadius: 9, backgroundColor: VOLT, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: NAVY_CARD, fontWeight: '800', fontSize: 14 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#9ca3af', marginTop: 4, marginBottom: 28, textAlign: 'center' },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 22,
    shadowColor: '#0b1220',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 30,
    elevation: 10,
  },
  tabs: { flexDirection: 'row', backgroundColor: '#f1f3f7', borderRadius: 10, padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: NAVY_CARD },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: VOLT },
  copy: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 18 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12.5, fontWeight: '600', color: '#374151', marginBottom: 5 },
  input: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fbfcfe', color: '#101828' },
  inputFocused: { borderColor: VOLT, backgroundColor: '#fff' },
  submitButton: { backgroundColor: NAVY_CARD, borderRadius: 9, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  submitButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  linkButton: { alignItems: 'center', marginTop: 14, padding: 4 },
  linkText: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
  msButton: { flexDirection: 'row', backgroundColor: '#fff', borderWidth: 1, borderColor: '#d0d5dd', borderRadius: 9, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 4 },
  msButtonText: { color: '#1a2233', fontSize: 14, fontWeight: '600' },
  msLogo: { width: 18, height: 18, gap: 2 },
  msLogoRow: { flexDirection: 'row', gap: 2, flex: 1 },
  msLogoSquare: { flex: 1 },
  errorText: { color: '#dc2626', marginTop: 14, textAlign: 'center', fontSize: 13 },
  infoText: { color: '#065f46', backgroundColor: '#ecfdf3', borderRadius: 8, padding: 10, marginTop: 14, fontSize: 13, lineHeight: 18 },
  devNote: { color: '#92400e', backgroundColor: '#fffbeb', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12.5, lineHeight: 18 },
  portalHint: { marginTop: 20, textAlign: 'center', fontSize: 12.5, color: '#6b7280' },
})
