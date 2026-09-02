import { useState, type ReactNode } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { dealerLogin, forgotDealerPassword, resetDealerPassword } from '../services/dealerAuthService'

type Mode = 'dealer' | 'staff'
type DealerStep = 'login' | 'forgot' | 'reset'

/** Mirrors web/src/pages/staff/LoginPage.tsx: two tabs (Dealer/Workshop local login vs Staff
 * Microsoft/Azure AD), with the same forgot/reset-password sub-flow under the Dealer tab. Unlike
 * the web version this screen never needs its own "already signed in -> redirect" check -
 * RootNavigator only ever mounts LoginScreen while isAuthenticated is false. */
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
        <Text style={styles.title}>JobCardScanner</Text>
        <Text style={styles.subtitle}>EV Two-Wheeler Workshop - Staff App</Text>

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
          <View style={styles.card}>
            <Text style={styles.copy}>
              For BGauss corporate &amp; system admins signing in with their @bgauss.com Microsoft account.
            </Text>
            {signingIn ? (
              <ActivityIndicator size="large" color="#101828" style={{ marginTop: 20 }} />
            ) : (
              <TouchableOpacity style={styles.msButton} onPress={signIn}>
                <Text style={styles.msButtonText}>Continue with Microsoft</Text>
              </TouchableOpacity>
            )}
            {azureError && <Text style={styles.errorText}>{azureError}</Text>}
          </View>
        ) : (
          <View style={styles.card}>
            {step === 'login' && (
              <>
                <Text style={styles.copy}>
                  For dealer workshop staff signing in with the email/dealer code &amp; password issued by your admin, or your BAPL DMS login.
                </Text>
                <Field label="Email or Dealer Code">
                  <TextInput
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@dealer.com or CUS0001"
                  />
                </Field>
                <Field label="Password">
                  <TextInput
                    style={styles.input}
                    secureTextEntry
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                  />
                </Field>
                <TouchableOpacity
                  style={[styles.submitButton, (!email || !password || submitting) && styles.buttonDisabled]}
                  disabled={!email || !password || submitting}
                  onPress={handleDealerLogin}
                >
                  <Text style={styles.submitButtonText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
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
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@dealer.com"
                  />
                </Field>
                <TouchableOpacity
                  style={[styles.submitButton, (!email || submitting) && styles.buttonDisabled]}
                  disabled={!email || submitting}
                  onPress={handleForgotPassword}
                >
                  <Text style={styles.submitButtonText}>{submitting ? 'Sending…' : 'Send reset link'}</Text>
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
                  <TextInput style={styles.input} value={resetToken} onChangeText={setResetToken} placeholder="Paste the token from your email" />
                </Field>
                <Field label="New password">
                  <TextInput
                    style={styles.input}
                    secureTextEntry
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="At least 8 characters"
                  />
                </Field>
                <TouchableOpacity
                  style={[styles.submitButton, (!resetToken || newPassword.length < 8 || submitting) && styles.buttonDisabled]}
                  disabled={!resetToken || newPassword.length < 8 || submitting}
                  onPress={handleResetPassword}
                >
                  <Text style={styles.submitButtonText}>{submitting ? 'Updating…' : 'Reset password'}</Text>
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f4f6f9' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#101828', textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 4, marginBottom: 24, textAlign: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: '#f1f3f7', borderRadius: 10, padding: 4, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#101828' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: '#8ef542' },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  copy: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 18 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12.5, fontWeight: '600', color: '#374151', marginBottom: 5 },
  input: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fbfcfe' },
  submitButton: { backgroundColor: '#101828', borderRadius: 9, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  submitButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  linkButton: { alignItems: 'center', marginTop: 14, padding: 4 },
  linkText: { color: '#2563eb', fontSize: 13 },
  msButton: { backgroundColor: '#101828', borderRadius: 9, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  msButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  errorText: { color: '#dc2626', marginTop: 14, textAlign: 'center', fontSize: 13 },
  infoText: { color: '#065f46', backgroundColor: '#ecfdf3', borderRadius: 8, padding: 10, marginTop: 14, fontSize: 13, lineHeight: 18 },
  devNote: { color: '#92400e', backgroundColor: '#fffbeb', borderRadius: 8, padding: 10, marginBottom: 14, fontSize: 12.5, lineHeight: 18 },
})
