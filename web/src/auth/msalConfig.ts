import type { Configuration } from '@azure/msal-browser'
import { PublicClientApplication } from '@azure/msal-browser'

// Staff sign-in configuration - see docs/AZURE_AD_SETUP.md for how to obtain these values
// from the Azure Portal. Customers never touch MSAL; they use mobile+OTP (see
// src/auth/CustomerAuthContext.tsx).
export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    // localStorage (not sessionStorage) so a signed-in session survives closing the browser
    // tab/window - otherwise MSAL forgets you the moment the tab closes and every visit
    // requires a fresh "Continue with Microsoft" sign-in, even though your Microsoft account
    // itself may still be signed in behind the scenes.
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
}

export const apiLoginRequest = {
  scopes: [import.meta.env.VITE_AZURE_API_SCOPE],
}

export const msalInstance = new PublicClientApplication(msalConfig)