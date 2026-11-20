import { ChevronDown, LogOut } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useCambiosPendientes } from '../../hooks/useCambiosPendientes'
import { ROL_LABEL } from '../../lib/usuarios'
import { hijoActivo, itemActivo, navParaRol, type NavItem } from './navegacion'

/* Elemento del menú con opciones: un botón que despliega (o pliega) sus opciones. Se abre solo
   al entrar a una de sus pantallas, y la persona puede plegarlo cuando quiera. */
function GrupoDesplegable({ item, estilo }: { item: NavItem; estilo: CSSProperties }) {
  const { pathname } = useLocation()
  const dentro = itemActivo(item, pathname)
  const [abierto, setAbierto] = useState(dentro)
  const Icono = item.icon

  useEffect(() => {
    if (dentro) setAbierto(true)
  }, [dentro])

  const idLista = `submenu-${item.id}`
  return (
    <div>
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={idLista}
        onClick={() => setAbierto((a) => !a)}
        style={{
          ...estilo,
          background: dentro && !abierto ? 'rgba(255,255,255,.12)' : 'transparent',
          color: dentro ? 'var(--blanco)' : 'rgba(255,255,255,.72)',
          font: `var(--fw-${dentro ? 'bold' : 'medium'}) var(--text-body-md)/1 var(--font-sans)`,
          cursor: 'pointer',
        }}
      >
        <Icono size={18} />
        <span style={{ flex: 1 }}>{item.label}</span>
        <ChevronDown size={16} style={{ transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
      </button>
      {abierto && (
        <div id={idLista} style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
          {item.hijos!.map((hijo) => {
            const activo = hijoActivo(hijo, pathname)
            return (
              <NavLink
                key={hijo.id}
                to={hijo.to}
                style={{
                  ...estilo,
                  height: 38,
                  paddingLeft: 'calc(var(--space-3) + 30px)',
                  background: activo ? 'rgba(255,255,255,.12)' : 'transparent',
                  color: activo ? 'var(--blanco)' : 'rgba(255,255,255,.72)',
                  font: `var(--fw-${activo ? 'bold' : 'medium'}) var(--text-body-sm, 14px)/1 var(--font-sans)`,
                  textDecoration: 'none',
                  cursor: 'pointer',
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

function iniciales(nombre: string) {
  return nombre
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('')
}

export function SidebarNav() {
  const { user, rol } = useAuth()
  const { cerrarSesionSegura } = useCambiosPendientes()
  const nombre = user?.email ?? ''

  return (
    <nav
      style={{
        width: 'var(--layout-sidebar)',
        flex: '0 0 var(--layout-sidebar)',
        minHeight: '100%',
        background: 'var(--surface-brand)',
        color: 'var(--text-invert)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: 'var(--space-6) var(--space-5) var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        <span style={{ font: 'var(--fw-bold) 21px/1 var(--font-sans)', letterSpacing: '-.02em' }}>Realza</span>
        <span
          style={{
            font: 'var(--fw-semibold) 11px/1 var(--font-sans)',
            letterSpacing: 'var(--ls-eyebrow)',
            color: 'var(--cobre-300)',
          }}
        >
          HOGAR · PANEL
        </span>
      </div>

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: 'var(--space-2) var(--space-3)', flex: 1 }}
      >
        {navParaRol(rol).map((item) => {
          const Icono = item.icon

          const contenido = (activo: boolean) => (
            <>
              <Icono size={18} />
              <span style={{ flex: 1 }}>{item.label}</span>
              {!item.to && (
                <span
                  style={{
                    font: 'var(--fw-semibold) 10px/1.4 var(--font-sans)',
                    letterSpacing: '.06em',
                    color: 'rgba(255,255,255,.45)',
                  }}
                >
                  PRONTO
                </span>
              )}
              {activo && null}
            </>
          )

          const estiloBase = {
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            width: '100%',
            padding: '0 var(--space-3)',
            height: 44,
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            textAlign: 'left' as const,
            transition: 'background var(--dur-fast) var(--ease-out)',
          }

          if (item.hijos) return <GrupoDesplegable key={item.id} item={item} estilo={estiloBase} />

          if (!item.to) {
            return (
              <span
                key={item.id}
                style={{
                  ...estiloBase,
                  background: 'transparent',
                  color: 'rgba(255,255,255,.38)',
                  font: 'var(--fw-medium) var(--text-body-md)/1 var(--font-sans)',
                  cursor: 'not-allowed',
                }}
              >
                {contenido(false)}
              </span>
            )
          }

          return (
            <NavLink
              key={item.id}
              to={item.to}
              style={({ isActive }) => ({
                ...estiloBase,
                background: isActive ? 'rgba(255,255,255,.12)' : 'transparent',
                color: isActive ? 'var(--blanco)' : 'rgba(255,255,255,.72)',
                font: `var(--fw-${isActive ? 'bold' : 'medium'}) var(--text-body-md)/1 var(--font-sans)`,
                textDecoration: 'none',
                cursor: 'pointer',
              })}
            >
              {({ isActive }) => contenido(isActive)}
            </NavLink>
          )
        })}
      </div>

      {user && (
        <div
          style={{
            borderTop: '1px solid rgba(255,255,255,.14)',
            padding: 'var(--space-4) var(--space-5)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              background: 'var(--cobre-500)',
              color: 'var(--nogal-900)',
              display: 'grid',
              placeItems: 'center',
              font: 'var(--fw-bold) 13px var(--font-sans)',
              flex: '0 0 auto',
            }}
          >
            {iniciales(nombre)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                font: 'var(--fw-semibold) 13px/1.3 var(--font-sans)',
                color: 'var(--blanco)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {nombre}
            </span>
            <span style={{ display: 'block', font: '11px/1.4 var(--font-sans)', color: 'var(--cobre-300)' }}>
              {rol ? ROL_LABEL[rol] : 'Sin rol'}
            </span>
          </span>
          <button
            onClick={cerrarSesionSegura}
            aria-label="Salir"
            title="Cerrar sesión"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,.6)',
              cursor: 'pointer',
              display: 'flex',
              padding: 4,
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      )}
    </nav>
  )
}
