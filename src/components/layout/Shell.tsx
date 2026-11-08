import type { ReactNode } from 'react'
import { useEsEscritorio } from '../../hooks/useMediaQuery'
import { BarraCambiosPendientes } from '../BarraCambiosPendientes'
import { SidebarNav } from './SidebarNav'
import { TabBar } from './TabBar'
import { TopBar } from './TopBar'

interface ShellProps {
  eyebrow?: string
  title: ReactNode
  actions?: ReactNode
  onSearch?: (valor: string) => void
  children: ReactNode
}

/* En escritorio: sidebar fija + contenido. En pantalla angosta: el mismo
   contenido a ancho completo con navegación inferior, para que un vendedor
   pueda usarlo desde el celular sin una app aparte. */
export function Shell({ eyebrow, title, actions, onSearch, children }: ShellProps) {
  const esEscritorio = useEsEscritorio()

  return (
    <div style={{ display: 'flex', height: '100svh', minHeight: 0, background: 'var(--surface-page)' }}>
      {esEscritorio && <SidebarNav />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar eyebrow={eyebrow} title={title} actions={actions} onSearch={onSearch} />
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: esEscritorio ? 'var(--gutter-page)' : 'var(--gutter-mobile)',
          }}
        >
          <div
            style={{
              maxWidth: 'var(--layout-max)',
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              gap: esEscritorio ? 'var(--space-6)' : 'var(--space-4)',
            }}
          >
            {children}
          </div>
        </main>
        {/* Solo se ve en las pantallas de producción y cuando hay algo que decir. */}
        <BarraCambiosPendientes />
        {!esEscritorio && <TabBar />}
      </div>
    </div>
  )
}
