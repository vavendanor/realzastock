import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { UserRole } from '../types'

interface AuthContextValue {
  user: User | null
  rol: UserRole | null
  cargando: boolean
  cerrarSesion: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [rol, setRol] = useState<UserRole | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCargando(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setRol(null)
      return
    }

    supabase
      .from('usuarios')
      .select('rol')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setRol((data?.rol as UserRole) ?? null)
      })
  }, [session])

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user: session?.user ?? null, rol, cargando, cerrarSesion }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un <AuthProvider>')
  }
  return context
}
