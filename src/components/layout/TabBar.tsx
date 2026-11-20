import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { hijoActivo, itemActivo, navParaRol, type NavItem } from './navegacion'

const estiloTab = (activo: boolean) =>
  ({
    flex: 1,
    minHeight: 64,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    textDecoration: 'none',
    color: activo ? 'var(--nogal-700)' : 'var(--text-faint)',
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
  }) as const

function contenidoTab(item: NavItem, activo: boolean) {
  const Icono = item.icon
  return (
    <>
      <Icono size={22} strokeWidth={activo ? 2.1 : 1.7} />
      <span style={{ font: `var(--fw-${activo ? 'bold' : 'medium'}) 11px/1 var(--font-sans)` }}>{item.etiquetaCorta ?? item.label}</span>
    </>
  )
}

/* Pestaña con opciones: al tocarla se abre un mini-menú sobre la barra. Se cierra al elegir una
   opción, al tocar fuera o con Escape. */
function TabConMenu({ item }: { item: NavItem }) {
  const { pathname } = useLocation()
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const activo = itemActivo(item, pathname)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  return (
    <div ref={raiz} style={{ flex: 1, display: 'flex', position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)} style={estiloTab(activo || abierto)}>
        {contenidoTab(item, activo || abierto)}
      </button>
      {abierto && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            minWidth: 210,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--surface-card)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md, 0 6px 20px rgba(0,0,0,.18))',
            overflow: 'hidden',
            zIndex: 30,
          }}
        >
          {item.hijos!.map((hijo) => {
            const hijoOn = hijoActivo(hijo, pathname)
            return (
              <NavLink
                key={hijo.id}
                to={hijo.to}
                role="menuitem"
                onClick={() => setAbierto(false)}
                style={{
                  minHeight: 52,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 var(--space-5)',
                  textDecoration: 'none',
                  color: hijoOn ? 'var(--nogal-700)' : 'var(--text-body)',
                  background: hijoOn ? 'var(--arena-200)' : 'transparent',
                  font: `var(--fw-${hijoOn ? 'bold' : 'medium'}) var(--text-body-md, 15px)/1 var(--font-sans)`,
                }}
              >
                {hijo.label}
              </NavLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* Navegación inferior para pantalla angosta. Solo muestra los módulos que
   ya existen: en el celular no tiene sentido ocupar espacio con items inertes. */
export function TabBar() {
  const { rol } = useAuth()
  const items = navParaRol(rol).filter((item) => item.to || item.hijos)

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
      {items.map((item) =>
        item.hijos ? (
          <TabConMenu key={item.id} item={item} />
        ) : (
          <NavLink key={item.id} to={item.to!} style={({ isActive }) => estiloTab(isActive)}>
            {({ isActive }) => contenidoTab(item, isActive)}
          </NavLink>
        ),
      )}
    </nav>
  )
}
