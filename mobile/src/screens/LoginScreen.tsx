import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'

export function LoginScreen() {
  const { signIn, signingIn, error } = useAuth()

  return (
    <View style={styles.container}>
      <Text style={styles.title}>JobCardScanner</Text>
      <Text style={styles.subtitle}>EV Two-Wheeler Workshop - Staff App</Text>
      {signingIn ? (
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 24 }} />
      ) : (
        <View style={{ marginTop: 24, width: '100%' }}>
          <Button title="Sign in with Microsoft" onPress={signIn} color="#2563eb" />
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#f4f6f9' },
  title: { fontSize: 28, fontWeight: '700', color: '#101828' },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  error: { color: '#dc2626', marginTop: 16, textAlign: 'center' },
})
