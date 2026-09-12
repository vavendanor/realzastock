import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { rutaInicial } from './layout/navegacion'
import { useAuth } from '../hooks/useAuth'
import type { UserRole } from '../types'

interface ProtectedRouteProps {
  children: ReactNode
  /* Si se indica, además de estar logueado el usuario debe tener uno de
     estos roles. Es solo la barrera de la interfaz: quien manda de verdad
     son las políticas de RLS en Supabase. */
  roles?: UserRole[]
}

function Pantalla({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100svh',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-6)',
        background: 'var(--surface-page)',
      }}
    >
      {children}
    </div>
  )
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, rol, cargando } = useAuth()

  if (cargando) {
    return (
      <Pantalla>
        <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando...</p>
      </Pantalla>
    )
  }

  /* `replace` (no un push normal) para que esta URL prohibida no quede en
     el historial — si no, "atrás" en el navegador volvería a caer acá. */
  if (!user) {
    return <Navigate to="/login" replace />
  }

  /* El rol llega en una segunda consulta, después de la sesión. */
  if (roles && rol === null) {
    return (
      <Pantalla>
        <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Verificando permisos...</p>
      </Pantalla>
    )
  }

  /* Si el rol no tiene acceso acá, se lo manda directo a la sección que sí
     puede ver por defecto, en vez de mostrarle un muro de "sin acceso".
     Esto es lo que evita que alguien quede varado en una URL de otro rol
     después de cerrar sesión ahí y volver a entrar con una cuenta distinta. */
  if (roles && !roles.includes(rol!)) {
    return <Navigate to={rutaInicial(rol) ?? '/'} replace />
  }

  return <>{children}</>
}
