// mobile\src\auth\AuthContext.tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import * as AuthSession from 'expo-auth-session'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { apiClient, setAccessToken } from '../api/client'
import type { CurrentUser } from '../types'
// 2026-09-28 (SECTION 135) - "attendance page also fix ... why check in time not shown": wires
// self check-in into the Azure AD sign-in success path too (see the response-handling effect
// below) - mirrors the same fix just made to the Dealer/Workshop path in LoginScreen.tsx. See that
// file's SECTION 135 comment and README SECTION 135 for the full reasoning, including why this is
// only wired into the actual OAuth-redirect-success effect below and NOT the on-launch
// restore-a-previously-saved-session effect above it (that one isn't a fresh "login").
import { checkInAfterLogin } from '../services/attendanceCheckin'

WebBrowser.maybeCompleteAuthSession()

const TENANT_ID = process.env.EXPO_PUBLIC_AZURE_TENANT_ID ?? ''
const CLIENT_ID = process.env.EXPO_PUBLIC_AZURE_CLIENT_ID ?? ''
const API_SCOPE = process.env.EXPO_PUBLIC_AZURE_API_SCOPE ?? ''

const DISCOVERY = {
  authorizationEndpoint: `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`,
  tokenEndpoint: `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
}

const TOKENS_KEY = 'jobcardscanner.tokens'

interface StoredTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number // epoch ms
}

interface AuthValue {
  profile: CurrentUser | null
  loading: boolean
  error: string | null
  signingIn: boolean
  signIn: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'jobcardscanner', path: 'auth' })

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: CLIENT_ID,
      scopes: ['openid', 'profile', 'offline_access', API_SCOPE],
      redirectUri,
      usePKCE: true,
    },
    DISCOVERY,
  )

  const [profile, setProfile] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  const loadProfile = async () => {
    setError(null)
    try {
      const { data } = await apiClient.get<CurrentUser>('/api/auth/me')
      setProfile(data)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not load your JobCardScanner profile. Contact your admin.'
      setError(message)
      setProfile(null)
    }
  }

  const persistTokens = async (result: AuthSession.TokenResponse) => {
    const tokens: StoredTokens = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: Date.now() + (result.expiresIn ?? 3600) * 1000 - 60_000,
    }
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens))
    setAccessToken(tokens.accessToken)
    return tokens
  }

  const refreshTokens = async (tokens: StoredTokens): Promise<StoredTokens | null> => {
    if (!tokens.refreshToken) return null
    try {
      const result = await AuthSession.refreshAsync(
        { clientId: CLIENT_ID, refreshToken: tokens.refreshToken },
        DISCOVERY,
      )
      return await persistTokens(result)
    } catch {
      return null
    }
  }

  // On launch, try to restore a session from previously stored tokens.
  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(TOKENS_KEY)
        if (!raw) return
        let tokens = JSON.parse(raw) as StoredTokens
        if (tokens.expiresAt < Date.now()) {
          const refreshed = await refreshTokens(tokens)
          if (!refreshed) {
            await SecureStore.deleteItemAsync(TOKENS_KEY)
            return
          }
          tokens = refreshed
        } else {
          setAccessToken(tokens.accessToken)
        }
        await loadProfile()
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle the redirect back from Azure AD's login page.
  useEffect(() => {
    if (response?.type !== 'success' || !request) return
    ;(async () => {
      setSigningIn(true)
      setError(null)
      try {
        const result = await AuthSession.exchangeCodeAsync(
          {
            clientId: CLIENT_ID,
            code: response.params.code,
            redirectUri,
            extraParams: { code_verifier: request.codeVerifier ?? '' },
          },
          DISCOVERY,
        )
        await persistTokens(result)
        await loadProfile()
        // 2026-09-28 (SECTION 135): self check-in, right after a successful Azure AD sign-in -
        // this is the actual "login" moment for the Staff (Microsoft) tab, matching
        // attendanceCheckin.ts's own doc comment (fire-and-forget, never throws). NOT added to the
        // on-launch session-restore effect above - that one silently re-uses a still-valid token
        // on cold start, which isn't the "when i login" event this was asked for.
        checkInAfterLogin()
      } catch {
        setError('Sign-in failed. Please try again.')
      } finally {
        setSigningIn(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response])

  const signOut = async () => {
    setAccessToken(null)
    await SecureStore.deleteItemAsync(TOKENS_KEY)
    setProfile(null)
  }

  const value = useMemo<AuthValue>(
    () => ({
      profile,
      loading,
      error,
      signingIn,
      signIn: () => promptAsync(),
      signOut,
    }),
    [profile, loading, error, signingIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
