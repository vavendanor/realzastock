import { NavLink } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { navParaRol } from './navegacion'

/* Navegación inferior para pantalla angosta. Solo muestra los módulos que
   ya existen: en el celular no tiene sentido ocupar espacio con items inertes. */
export function TabBar() {
  const { rol } = useAuth()
  const items = navParaRol(rol).filter((item) => item.to)

  if (items.length === 0) return null

  return (
    <nav
      style={{
        flex: '0 0 auto',
        display: 'flex',
        background: 'var(--surface-card)',
        borderTop: '1px solid var(--border-hairline)',
        paddingBottom: 'env(safe-area-inset-bottom, 6px)',
      }}
    >
      {items.map((item) => {
        const Icono = item.icon
        return (
          <NavLink
            key={item.id}
            to={item.to!}
            style={({ isActive }) => ({
              flex: 1,
              minHeight: 64,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              textDecoration: 'none',
              color: isActive ? 'var(--nogal-700)' : 'var(--text-faint)',
            })}
          >
            {({ isActive }) => (
              <>
                <Icono size={22} strokeWidth={isActive ? 2.1 : 1.7} />
                <span style={{ font: `var(--fw-${isActive ? 'bold' : 'medium'}) 11px/1 var(--font-sans)` }}>
                  {item.etiquetaCorta ?? item.label}
                </span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
