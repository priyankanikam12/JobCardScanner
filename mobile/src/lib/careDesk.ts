// mobile\src\lib\careDesk.ts
import { Alert } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { apiClient } from '../api/client'

/**
 * 2026-10-22 (Android counterpart of web/src/lib/careDesk.ts): the ONE way the app opens BGauss Care Desk signed in.
 *   1. asks the JobCard API for a 60-second, single-use token for the person who is signed in HERE (Microsoft or Dealer login - both work): POST /api/care-desk/sso-token
 *   2. opens Care Desk's /api/auth/sso with that token and the page to land on (`path`); Care Desk signs the same person in and redirects to the page - no second login.
 * path: '' or '/' = the person's own home in Care Desk; '/field/search?q=<chassis>' = the search for a vehicle; '/field/tickets/<ticket no>' = one ticket.
 * The page opens in the phone's browser tab (expo-web-browser). Care Desk must have the person's work email registered, otherwise its login page says so.
 *
 * EXPO_PUBLIC_CARE_DESK_URL is the Care Desk address with no slash at the end (empty = Care Desk is not set up in this build; its screens say so).
 */
export const CARE_DESK_URL: string = (process.env.EXPO_PUBLIC_CARE_DESK_URL ?? '').trim().replace(/\/+$/, '')

export async function openCareDesk(path = ''): Promise<void> {
  if (!CARE_DESK_URL) {
    Alert.alert('Care Desk', 'Care Desk is not set up in this app (EXPO_PUBLIC_CARE_DESK_URL).')
    return
  }
  try {
    const { data } = await apiClient.post<{ token: string }>('/api/care-desk/sso-token')
    const next = path && path !== '/' ? `&next=${encodeURIComponent(path)}` : ''
    await WebBrowser.openBrowserAsync(`${CARE_DESK_URL}/api/auth/sso?token=${encodeURIComponent(data.token)}${next}`)
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    Alert.alert('Care Desk', status === 403 ? 'Your login is not allowed to open Care Desk (CorporateAdmin / SystemAdmin only).' : 'Could not open Care Desk. Please try again.')
  }
}
