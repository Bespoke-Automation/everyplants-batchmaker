'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { createAuthBrowserClient } from '@/lib/supabase/browser'
import type { User, AuthChangeEvent, Session } from '@supabase/supabase-js'

export interface UserProfile {
  id: string
  display_name: string
  email: string
  is_admin: boolean
  module_batchmaker: boolean
  module_verpakkingsmodule: boolean
  module_floriday: boolean
  module_raapmodule: boolean
  module_bestellijst: boolean
  module_incidenten: boolean
  picqer_user_id: number | null
}

interface AuthContextValue {
  user: User | null
  profile: UserProfile | null
  isLoading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  isLoading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
})

async function fetchProfileFromApi(): Promise<UserProfile | null> {
  try {
    const res = await fetch('/api/auth/profile')
    if (!res.ok) return null
    const { profile } = await res.json()
    return profile
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const initialized = useRef(false)
  const supabase = createAuthBrowserClient()

  const refreshProfile = useCallback(async () => {
    const p = await fetchProfileFromApi()
    setProfile(p)
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: AuthChangeEvent, session: Session | null) => {
        const currentUser = session?.user ?? null
        setUser(currentUser)

        if (currentUser) {
          const p = await fetchProfileFromApi()
          setProfile(p)
        } else {
          setProfile(null)
        }

        setIsLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase])

  const signOut = useCallback(async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    setUser(null)
    setProfile(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, profile, isLoading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
