import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MsalProvider } from '@azure/msal-react'
import { msalInstance } from './auth/msalConfig'
import { StaffAuthProvider } from './auth/StaffAuthContext'
import { CustomerAuthProvider } from './auth/CustomerAuthContext'
import App from './App'
import './styles/global.css'

async function bootstrap() {
  try {
    await msalInstance.initialize()
  } catch (err) {
    // MSAL's PKCE flow needs the browser's Web Crypto `subtle` API, which only exists in a
    // "secure context" (HTTPS, or http://localhost) - on a plain-HTTP deployment (see
    // deploy/DEPLOYMENT_GUIDE_PUBLIC_IP.md) this throws BrowserAuthError: crypto_nonexistent.
    // Without this try/catch, that failure happened here BEFORE the app ever rendered, taking
    // down the entire site - including the Dealer/Workshop login tab, which doesn't use MSAL at
    // all and has no reason to be affected by it. Swallowing it here means "Continue with
    // Microsoft" simply won't work (it'll fail when actually clicked, same underlying cause),
    // but everything else - Dealer/Workshop login, the whole rest of the app - still does.
    console.warn('MSAL failed to initialize - Azure AD sign-in will be unavailable this session.', err)
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <StaffAuthProvider>
          <CustomerAuthProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </CustomerAuthProvider>
        </StaffAuthProvider>
      </MsalProvider>
    </StrictMode>,
  )
}

bootstrap()
