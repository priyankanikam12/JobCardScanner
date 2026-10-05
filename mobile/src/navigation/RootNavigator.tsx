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
// 2026-09-21 ("add changes in android also"): the Android counterparts of web's Item Master/
// Material Transfer Bill/Repair Bill sidebar pages - see each screen's own doc comment.
import { ItemMasterScreen } from '../screens/ItemMasterScreen'
import { MaterialTransferCreateScreen } from '../screens/MaterialTransferCreateScreen'
import { RepairBillCreateScreen } from '../screens/RepairBillCreateScreen'
// 2026-09-23 ("this main in 1 page not on same only which are save in jobcard db that in grid
// button"): new list screen for JobCardScanner's own saved Repair Bills, split out of
// RepairBillCreateScreen above - see that screen's own doc comment and RepairBillListScreen.tsx.
import { RepairBillListScreen } from '../screens/RepairBillListScreen'
// 2026-09-24 "that supervisor when login then he have access to create Tecnician that tab name
// Technician Employee" - see TechnicianEmployeesScreen.tsx's own doc comment.
import { TechnicianEmployeesScreen } from '../screens/TechnicianEmployeesScreen'
// 2026-09-28 ("this page also add in android") - Android counterparts of web's Part Upload/
// Labour Master sidebar pages, added the same round as DashboardScreen.tsx's two new
// ActionCards - see each screen's own doc comment (PartUploadPage.tsx/LabourMasterPage.tsx web
// pages they mirror, and the simplifications flagged there: no Excel/PDF export, chip-style
// Location/Rate Type instead of a native dropdown, expo-document-picker for the file picker).
import { PartUploadScreen } from '../screens/PartUploadScreen'
import { LabourMasterScreen } from '../screens/LabourMasterScreen'
// 2026-09-28 FIX ("this page not linked in android?") - AttendanceScreen.tsx (built 2026-09-25)
// was never registered here at all - no import, no RootStackParamList entry, no Stack.Screen, and
// DashboardScreen.tsx had no ActionCard pointing to it either, so there was genuinely no way to
// reach it on Android. Confirmed by re-reading this file - "Attendance" didn't appear anywhere in
// it before this fix. Default import (not `{ AttendanceScreen }`) since that screen, unlike every
// other one here, uses `export default function AttendanceScreen()` - left as-is rather than
// changed, to keep this a minimal, targeted fix.
import AttendanceScreen from '../screens/AttendanceScreen'
// 2026-10-02 ("for mobile also give this repair bill and material transfer both page report") -
// read-only DMSBAPLDATA report screens, the mobile counterparts of web/src/pages/staff/
// RepairBillPage.tsx and MaterialTransferPage.tsx. Named "...ReportScreen" (not
// RepairBillScreen/MaterialTransferScreen) to stay distinct from the UNRELATED, already-registered
// RepairBillCreateScreen/RepairBillListScreen/MaterialTransferCreateScreen above (JobCardScannerDb-
// native creation workflow) - see each new screen's own doc comment.
import { RepairBillReportScreen } from '../screens/RepairBillReportScreen'
import { MaterialTransferReportScreen } from '../screens/MaterialTransferReportScreen'
import { colors } from '../theme/colors'
import { DealerRoleReportScreen } from '../screens/DealerRoleReportScreen'
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
  ItemMaster: undefined
  MaterialTransferCreate: undefined
  // 2026-09-23 - optional editBillId param lets RepairBillListScreen open this same screen already
  // in edit mode for a given bill, the Android equivalent of web's /repair-bill-new?editId={id}.
  RepairBillCreate: { editBillId?: string } | undefined
  RepairBillList: undefined
  TechnicianEmployees: undefined
  // 2026-09-28 - both screens take no params, same shape as ItemMaster/RepairBillList above.
  PartUpload: undefined
  LabourMaster: undefined
  // 2026-09-28 FIX - see this file's own import comment above.
  // SECTION 172 (2026-09-30) "Attendance only personal" - optional onlyMine param, set true by
  // DashboardScreen.tsx's own Attendance card so it always opens straight to the "my own
  // attendance" view instead of the manager dealer-roster view a WorkshopManager+ login would
  // otherwise get - see AttendanceScreen.tsx's own SECTION 172 doc comment for the mechanics.
  // Left optional (not required) so any other future entry point that omits it keeps today's
  // existing server-decided (403 -> personal) behavior unchanged.
  Attendance: { onlyMine?: boolean } | undefined
  // 2026-10-02 - both screens take no params, same shape as PartUpload/LabourMaster above. See
  // this file's own import comment for why these are separate routes from RepairBillCreate/
  // MaterialTransferCreate rather than reusing those names.
  RepairBillReport: undefined
  MaterialTransferReport: undefined
  DealerRoleReport: undefined
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
          <Stack.Screen name="ItemMaster" component={ItemMasterScreen} options={{ title: 'Item Master' }} />
          <Stack.Screen name="MaterialTransferCreate" component={MaterialTransferCreateScreen} options={{ title: 'Material Transfer Bill' }} />
          <Stack.Screen name="RepairBillList" component={RepairBillListScreen} options={{ title: 'Repair Bill List' }} />
          <Stack.Screen name="RepairBillCreate" component={RepairBillCreateScreen} options={{ title: 'Repair Bill' }} />
          <Stack.Screen name="TechnicianEmployees" component={TechnicianEmployeesScreen} options={{ title: 'Technician Employee' }} />
          {/* 2026-09-28 ("this page also add in android") */}
          <Stack.Screen name="PartUpload" component={PartUploadScreen} options={{ title: 'Stock Report' }} />
          <Stack.Screen name="LabourMaster" component={LabourMasterScreen} options={{ title: 'Labour Master' }} />
          {/* 2026-09-28 FIX ("this page not linked in android?") */}
          <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Attendance' }} />
          {/* 2026-10-02 - DMSBAPLDATA report screens, see this file's own import comment above.
             Not yet on DashboardScreen.tsx's Actions list (see that screen's own note) - reachable
             by navigation.navigate('RepairBillReport' | 'MaterialTransferReport') for now. */}
          <Stack.Screen name="RepairBillReport" component={RepairBillReportScreen} options={{ title: 'Repair Bill Report' }} />
          <Stack.Screen name="MaterialTransferReport" component={MaterialTransferReportScreen} options={{ title: 'Material Transfer Report' }} />
          <Stack.Screen name="DealerRoleReport" component={DealerRoleReportScreen} options={{ title: 'Dealer Role Report' }} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  )
}
