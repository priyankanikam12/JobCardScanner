import axios from 'axios'

const baseURL = process.env.EXPO_PUBLIC_API_BASE_URL

export const apiClient = axios.create({ baseURL })

let cachedAccessToken: string | null = null

/** Called by AuthContext whenever the Azure AD access token is issued/refreshed/cleared. */
export function setAccessToken(token: string | null) {
  cachedAccessToken = token
}

apiClient.interceptors.request.use((config) => {
  if (cachedAccessToken) {
    config.headers.Authorization = `Bearer ${cachedAccessToken}`
  }
  return config
})
