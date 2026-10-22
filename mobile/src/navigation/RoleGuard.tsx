// mobile\src\navigation\RoleGuard.tsx
import type { ComponentType } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useStaffAuth } from '../auth/StaffAuthContext'
import type { StaffRole } from '../types'
import type { RootStackParamList } from './RootNavigator'
import { colors } from '../theme/colors'

/**
 * Screen-level companion to the Dashboard's menu-rights filtering - the Android version of web/src/components/RequireRole.tsx. A card that is hidden for a role is only a real restriction if opening
 * the screen another way (a link from another screen, a deep link) is blocked too. Wrap a screen with withRoleGuard(Screen, roles) and anyone whose role is not in the list sees "No access" and a button
 * back to the Dashboard instead of the screen. (Web redirects silently; a phone has no URL bar, so saying why is kinder.) hasRole() keeps its "Up" rule: DealerAdmin / CorporateAdmin / SystemAdmin can act
 * as any lower role in their scope.
 */
function AccessDenied() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>🔒 No access</Text>
      <Text style={styles.text}>Your role cannot open this page. If you need it, ask your administrator to change your menu access.</Text>
      <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Dashboard')}>
        <Text style={styles.btnText}>Back to Dashboard</Text>
      </TouchableOpacity>
    </View>
  )
}

export function withRoleGuard<P extends object>(Component: ComponentType<P>, roles: StaffRole[]): ComponentType<P> {
  const Guarded = (props: P) => {
    const { hasRole, profile } = useStaffAuth()
    if (!profile) return null // the profile is still loading - render nothing briefly rather than a false "no access"
    if (!hasRole(...roles)) return <AccessDenied />
    return <Component {...props} />
  }
  Guarded.displayName = `Guarded(${Component.displayName ?? Component.name ?? 'Screen'})`
  return Guarded
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  text: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 16 },
  btn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 18 },
  btnText: { color: '#fff', fontWeight: '700' },
})
