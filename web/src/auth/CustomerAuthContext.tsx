import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

interface CustomerSession {
  accessToken: string
  customerId: string
  name: string
}

interface CustomerAuthValue {
  session: CustomerSession | null
  signIn: (session: CustomerSession) => void
  signOut: () => void
}

const STORAGE_KEY = 'jobcardscanner.customerSession'

const CustomerAuthContext = createContext<CustomerAuthValue | undefined>(undefined)

function loadStored(): CustomerSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CustomerSession) : null
  } catch {
    return null
  }
}

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CustomerSession | null>(() => loadStored())

  const value = useMemo<CustomerAuthValue>(
    () => ({
      session,
      signIn: (s) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
        setSession(s)
      },
      signOut: () => {
        localStorage.removeItem(STORAGE_KEY)
        setSession(null)
      },
    }),
    [session],
  )

  return <CustomerAuthContext.Provider value={value}>{children}</CustomerAuthContext.Provider>
}

export function useCustomerAuth() {
  const ctx = useContext(CustomerAuthContext)
  if (!ctx) throw new Error('useCustomerAuth must be used within CustomerAuthProvider')
  return ctx
}
