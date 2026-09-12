import { Download, Share, SquarePlus, X } from 'lucide-react'
import { useState } from 'react'
import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { useEsEscritorio } from '../../hooks/useMediaQuery'
import { IconButton } from '../ui/IconButton'

/* Vive en TopBar (no en SidebarNav ni en TabBar) porque es el único punto
   del layout que Shell renderiza siempre, para cualquier rol -- así aparece
   igual para administrador, vendedor y bodega sin agregarlo en varios
   lugares. Se limita a pantallas angostas a propósito: en escritorio no se
   muestra, aunque el navegador sí pueda instalarla. */
export function InstallButton() {
  const esEscritorio = useEsEscritorio()
  const { mostrarBoton, esIOS, puedeInstalarNativo, instalar } = useInstallPrompt()
  const [mostrarInstruccionesIOS, setMostrarInstruccionesIOS] = useState(false)

  if (esEscritorio || !mostrarBoton) return null

  const alHacerClic = () => {
    if (puedeInstalarNativo) {
      void instalar()
    } else if (esIOS) {
      // iOS no tiene un prompt programático: no queda más que explicar
      // el camino manual (Compartir -> Agregar a pantalla de inicio).
      setMostrarInstruccionesIOS(true)
    }
  }

  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}>
      <IconButton label="Instalar app" variant="outline" onClick={alHacerClic}>
        <Download size={16} />
      </IconButton>

      {mostrarInstruccionesIOS && (
        <>
          {/* Capa invisible para cerrar al hacer clic afuera, antes que
              nada más reciba el clic. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMostrarInstruccionesIOS(false)} />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + var(--space-2))',
              right: 0,
              zIndex: 41,
              width: 280,
              background: 'var(--surface-card)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-raised)',
              padding: 'var(--space-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
              <span style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>Instalar en iPhone/iPad</span>
              <button
                onClick={() => setMostrarInstruccionesIOS(false)}
                aria-label="Cerrar"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', padding: 2, flex: '0 0 auto' }}
              >
                <X size={16} />
              </button>
            </div>
            <ol style={{ margin: 'var(--space-3) 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-body)' }}>
                <Share size={18} color="var(--text-muted)" style={{ flex: '0 0 auto' }} />
                Toca el ícono de <strong>Compartir</strong> en Safari
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-body)' }}>
                <SquarePlus size={18} color="var(--text-muted)" style={{ flex: '0 0 auto' }} />
                Elige <strong>"Agregar a pantalla de inicio"</strong>
              </li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}
