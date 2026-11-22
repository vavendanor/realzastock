import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { rutaInicial, rutaPermitidaEnApp } from './layout/navegacion'
import { esApp } from '../lib/plataforma'
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

/* En el APK de bodega, quien no es bodega ve esto en vez de la app. Siempre trae el botón para cerrar sesión. */
function SoloBodega({ verificando }: { verificando: boolean }) {
  const { cerrarSesion } = useAuth()
  return (
    <Pantalla>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <h2 data-solo-bodega={verificando ? undefined : ''} style={{ font: 'var(--type-h3)' }}>
          {verificando ? 'Verificando tu cuenta...' : 'Esta app es solo para bodega'}
        </h2>
        <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)', maxWidth: '44ch' }}>
          {verificando ? 'Si esto no avanza, cierra sesión e inténtalo de nuevo.' : 'Esta app es solo para bodega. Usa la versión web.'}
        </p>
        <button
          onClick={() => void cerrarSesion()}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-link)', cursor: 'pointer', font: 'var(--type-body)' }}
        >
          Cerrar sesión
        </button>
      </div>
    </Pantalla>
  )
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, rol, cargando } = useAuth()
  const { pathname } = useLocation()

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

  /* APK de bodega: solo entra el rol bodega, y solo a las pantallas de producción. Dashboard, Usuarios, Probador y
     cualquier otra ruta redirigen al inicio ("/"), que lleva a Pedidos. En la web normal esto no corre. */
  if (esApp()) {
    if (rol === null) return <SoloBodega verificando />
    if (rol !== 'bodega') return <SoloBodega verificando={false} />
    if (pathname !== '/' && !rutaPermitidaEnApp(pathname)) return <Navigate to="/" replace />
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
