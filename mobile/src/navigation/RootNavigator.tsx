import { ActivityIndicator, Button, View } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuth } from '../auth/AuthContext'
import { LoginScreen } from '../screens/LoginScreen'
import { DashboardScreen } from '../screens/DashboardScreen'
import { JobCardsListScreen } from '../screens/JobCardsListScreen'
import { JobCardDetailScreen } from '../screens/JobCardDetailScreen'
import { PartsScreen } from '../screens/PartsScreen'

export type RootStackParamList = {
  Dashboard: undefined
  JobCardsList: undefined
  JobCardDetail: { id: string }
  Parts: undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export function RootNavigator() {
  const { profile, loading, signOut } = useAuth()

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    )
  }

  return (
    <NavigationContainer>
      {!profile ? (
        <LoginScreen />
      ) : (
        <Stack.Navigator screenOptions={{ headerRight: () => <Button title="Sign out" onPress={signOut} /> }}>
          <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'JobCardScanner' }} />
          <Stack.Screen name="JobCardsList" component={JobCardsListScreen} options={{ title: 'Job Cards' }} />
          <Stack.Screen name="JobCardDetail" component={JobCardDetailScreen} options={{ title: 'Job Card' }} />
          <Stack.Screen name="Parts" component={PartsScreen} options={{ title: 'Parts Catalog' }} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  )
}
