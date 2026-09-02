import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { AuthProvider } from './src/auth/AuthContext'
import { StaffAuthProvider } from './src/auth/StaffAuthContext'
import { RootNavigator } from './src/navigation/RootNavigator'

export default function App() {
  return (
    <SafeAreaProvider>
      {/* AuthProvider (Azure AD) must be the outer provider - StaffAuthProvider reads from it via
         useAuth() internally to merge it with the local Dealer/Workshop session. */}
      <AuthProvider>
        <StaffAuthProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </StaffAuthProvider>
      </AuthProvider>
    </SafeAreaProvider>
  )
}
