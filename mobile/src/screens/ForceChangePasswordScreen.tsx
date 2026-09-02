import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { changeMyPassword } from '../services/dealerAuthService'
import { clearMustChangePassword } from '../auth/dealerSession'
import { useStaffAuth } from '../auth/StaffAuthContext'

/**
 * Forced first-sign-in / post-admin-reset password change for local "Dealer / Workshop Login"
 * accounts - mirrors web/src/pages/staff/ForceChangePasswordPage.tsx. RootNavigator renders this
 * instead of the main app whenever the signed-in dealer session's mustChangePassword flag is set
 * (every account created by the admin "Bulk import dealers from ERP" flow starts on the same
 * shared default password, so this is what actually forces it to be replaced).
 */
export function ForceChangePasswordScreen() {
  const { refresh } = useStaffAuth()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
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
      await clearMustChangePassword()
      // Flips mustChangePassword to false in StaffAuthContext, which lets RootNavigator swap this
      // screen out for the main app - no fresh sign-in required.
      await refresh()
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
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>JobCardScanner</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Set a new password</Text>
          <Text style={styles.copy}>
            This is either your first sign-in or your password was just reset by an admin. Choose a password only you know before continuing.
          </Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Current (temporary) password</Text>
            <TextInput style={styles.input} secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>New password</Text>
            <TextInput style={styles.input} secureTextEntry value={newPassword} onChangeText={setNewPassword} placeholder="At least 8 characters" />
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Confirm new password</Text>
            <TextInput style={styles.input} secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, (!currentPassword || !newPassword || !confirmPassword || submitting) && styles.buttonDisabled]}
            disabled={!currentPassword || !newPassword || !confirmPassword || submitting}
            onPress={handleSubmit}
          >
            <Text style={styles.submitButtonText}>{submitting ? 'Saving…' : 'Set password and continue'}</Text>
          </TouchableOpacity>

          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f4f6f9' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#101828', textAlign: 'center', marginBottom: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  heading: { fontSize: 18, fontWeight: '700', color: '#101828', marginBottom: 8 },
  copy: { fontSize: 13, color: '#6b7280', lineHeight: 19, marginBottom: 18 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12.5, fontWeight: '600', color: '#374151', marginBottom: 5 },
  input: { borderWidth: 1, borderColor: '#e2e6ec', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, backgroundColor: '#fbfcfe' },
  submitButton: { backgroundColor: '#101828', borderRadius: 9, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  submitButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  errorText: { color: '#dc2626', marginTop: 14, textAlign: 'center', fontSize: 13 },
})
