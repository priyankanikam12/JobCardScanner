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
import { colors } from '../theme/colors'

/** Optional /jobcards-equivalent filters the Dashboard's KPI cards deep-link with - each name
 * matches JobCardsController.List's own dashboard-filter query params 1:1 (see
 * DashboardScreen.tsx's KPIS array and web/src/pages/staff/DashboardPage.tsx's same mapping). */
export type JobCardsListFilter = {
  status?: string
  stageKey?: string
  excludeClosed?: boolean
  overdue?: boolean
  createdToday?: boolean
  deliveredToday?: boolean
  closedThisMonth?: boolean
  warrantyOnly?: boolean
  pendingBucket?: boolean
}

export type RootStackParamList = {
  Dashboard: undefined
  JobCardsList: JobCardsListFilter | undefined
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
        <Stack.Navigator
          // Dark navy native header (Hub Pulse reskin, 2026-09-04) - applies across every screen
          // from one place, matching the sister BGauss "Hub Downtime Captain"/"Hub Pulse" app's
          // dark phone-header bars. Individual screens no longer render their own duplicate
          // in-content navy band for the page title - see DashboardScreen/JobCardsListScreen/
          // JobCardDetailScreen, whose top sections now sit directly below this native header.
          screenOptions={{
            headerRight: () => <Button title="Sign out" color={colors.amber} onPress={signOut} />,
            headerStyle: { backgroundColor: colors.navy },
            headerTintColor: '#fff',
            headerTitleStyle: { color: '#fff', fontWeight: '700' },
          }}
        >
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
