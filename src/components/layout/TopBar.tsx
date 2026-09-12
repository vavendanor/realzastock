import { LogOut, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useEsEscritorio } from '../../hooks/useMediaQuery'
import { InstallButton } from './InstallButton'

interface TopBarProps {
  title: ReactNode
  eyebrow?: string
  actions?: ReactNode
  onSearch?: (valor: string) => void
  searchPlaceholder?: string
}

export function TopBar({ title, eyebrow, actions = null, onSearch, searchPlaceholder = 'Buscar SKU o modelo' }: TopBarProps) {
  const esEscritorio = useEsEscritorio()
  const { cerrarSesion } = useAuth()

  return (
    <header
      style={{
        minHeight: 'var(--layout-topbar)',
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: esEscritorio ? 'var(--space-5)' : 'var(--space-3)',
        padding: esEscritorio ? '0 var(--gutter-page)' : 'var(--space-2) var(--gutter-mobile)',
        background: 'var(--surface-card)',
        borderBottom: '1px solid var(--border-hairline)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }}>
        {eyebrow && <span className="rh-eyebrow">{eyebrow}</span>}
        <span
          style={{
            font: `var(--fw-medium) ${esEscritorio ? '22px' : '19px'}/1.2 var(--font-display)`,
            color: 'var(--text-strong)',
            letterSpacing: 'var(--ls-display)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>
      </div>

      {/* El buscador ocupa demasiado ancho en celular: ahí se omite y queda
          el filtrado de cada pantalla. */}
      {onSearch && esEscritorio && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            height: 'var(--control-h-sm)',
            padding: '0 var(--space-3)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--arena-100)',
            width: 260,
            flex: '0 1 260px',
            minWidth: 0,
          }}
        >
          <Search size={15} color="var(--text-faint)" />
          <input
            placeholder={searchPlaceholder}
            onChange={(event) => onSearch(event.target.value)}
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              font: 'var(--type-body)',
              fontSize: 'var(--text-body-sm)',
              flex: 1,
              minWidth: 0,
            }}
          />
        </label>
      )}

      <InstallButton />

      {actions && (
        <div style={{ flex: '0 0 auto', display: 'flex', gap: esEscritorio ? 'var(--space-3)' : 'var(--space-2)', alignItems: 'center' }}>
          {actions}
        </div>
      )}

      {/* En celular la sidebar está oculta, así que el botón de salir
          tiene que vivir acá. */}
      {!esEscritorio && (
        <button
          onClick={cerrarSesion}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          style={{
            flex: '0 0 auto',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-faint)',
            cursor: 'pointer',
            display: 'flex',
            padding: 6,
          }}
        >
          <LogOut size={18} />
        </button>
      )}
    </header>
  )
}
