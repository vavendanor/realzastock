import { Navigate } from 'react-router-dom'
import { rutaInicial } from '../components/layout/navegacion'
import { useAuth } from '../hooks/useAuth'
import { useCambiosPendientes } from '../hooks/useCambiosPendientes'
import { Dashboard } from './Dashboard'

/* Cada rol entra a un lugar distinto. El administrador se queda acá mismo
   (ve el Dashboard); los demás roles se redirigen a su propio módulo. */
export function Inicio() {
  const { rol } = useAuth()
  const { cerrarSesionSegura } = useCambiosPendientes()

  if (rol === 'administrador') return <Dashboard />

  const destino = rutaInicial(rol)
  if (destino) return <Navigate to={destino} replace />

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
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {rol === null ? (
          <>
            <h2 style={{ font: 'var(--type-h3)' }}>Verificando tu cuenta...</h2>
            <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)', maxWidth: '44ch' }}>
              Si esto no avanza, tu cuenta puede no tener un rol asignado. Cierra sesión o pídele ayuda a un administrador.
            </p>
          </>
        ) : (
          <>
            <h2 data-sin-acceso style={{ font: 'var(--type-h3)' }}>Tu cuenta no tiene acceso</h2>
            <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)', maxWidth: '44ch' }}>
              Esta aplicación es solo para el equipo de administración y bodega. Si crees que es un error, pídele a un
              administrador que revise tu cuenta.
            </p>
          </>
        )}
        <button
          onClick={cerrarSesionSegura}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-link)',
            cursor: 'pointer',
            font: 'var(--type-body)',
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}
