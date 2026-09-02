import { ActivityIndicator, Button, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useStaffAuth } from '../auth/StaffAuthContext'
import { LoginScreen } from '../screens/LoginScreen'
import { ForceChangePasswordScreen } from '../screens/ForceChangePasswordScreen'
import { DashboardScreen } from '../screens/DashboardScreen'
import { JobCardsListScreen } from '../screens/JobCardsListScreen'
import { JobCardDetailScreen } from '../screens/JobCardDetailScreen'
import { JobCardWizardScreen } from '../screens/JobCardWizardScreen'
import { PartsScreen } from '../screens/PartsScreen'

export type RootStackParamList = {
  Dashboard: undefined
  JobCardsList: undefined
  JobCardDetail: { id: string }
  JobCardWizard: undefined
  Parts: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  // isAuthenticated/mustChangePassword cover BOTH sign-in paths - Azure AD and the local
  // Dealer/Workshop session - see StaffAuthContext's doc comment.
  const { isAuthenticated, mustChangePassword, loading, signOut } = useStaffAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    )
  }

  // Every dealer login created by the admin "Bulk import dealers from ERP" flow (or reset by an
  // admin) starts on the same shared default password - force it to be replaced with something
  // only the dealer knows before letting them anywhere else in the app, same as web's RequireStaff
  // redirecting to /change-password. Azure AD staff never carry this flag.
  const showForceChangePassword = isAuthenticated && mustChangePassword

  return (
    <NavigationContainer>
      {!isAuthenticated ? (
        <LoginScreen />
      ) : showForceChangePassword ? (
        <ForceChangePasswordScreen />
      ) : (
        <Stack.Navigator screenOptions={{ headerRight: () => <Button title="Sign out" onPress={signOut} /> }}>
          <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'JobCardScanner' }} />
          <Stack.Screen name="JobCardsList" component={JobCardsListScreen} options={{ title: 'Job Cards' }} />
          <Stack.Screen name="JobCardDetail" component={JobCardDetailScreen} options={{ title: 'Job Card' }} />
          <Stack.Screen name="JobCardWizard" component={JobCardWizardScreen} options={{ title: 'New Job Card' }} />
          <Stack.Screen name="Parts" component={PartsScreen} options={{ title: 'Parts Catalog' }} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  )
}
