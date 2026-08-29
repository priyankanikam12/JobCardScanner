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
  await msalInstance.initialize()

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
