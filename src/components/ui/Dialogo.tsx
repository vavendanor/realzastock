import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface DialogoProps {
  titulo: string
  children: ReactNode
  /* Botones de abajo. El que lleve data-inicial recibe el foco al abrir; si
     ninguno, el primero. */
  acciones: ReactNode
  /* Se llama al pulsar Escape. Tocar el fondo NO cierra: una pulsación suelta no
     debe descartar nada. */
  alCancelar: () => void
}

const FOCALIZABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/* Ventana de confirmación sobre la pantalla. Se monta con un portal en <body>.
   Mantiene el foco dentro mientras está abierta y se cierra con Escape. */
export function Dialogo({ titulo, children, acciones, alCancelar }: DialogoProps) {
  const idTitulo = useId()
  const caja = useRef<HTMLDivElement>(null)
  const cancelar = useRef(alCancelar)
  useLayoutEffect(() => {
    cancelar.current = alCancelar
  })

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null
    const botones = () => [...(caja.current?.querySelectorAll<HTMLElement>(FOCALIZABLES) ?? [])]
    ;(caja.current?.querySelector<HTMLElement>('[data-inicial]') ?? botones()[0])?.focus()

    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancelar.current()
        return
      }
      if (e.key !== 'Tab') return
      const lista = botones()
      if (lista.length === 0) return
      const primero = lista[0]
      const ultimo = lista[lista.length - 1]
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alTeclear, true)
    return () => {
      document.removeEventListener('keydown', alTeclear, true)
      previo?.focus?.()
    }
  }, [])

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'grid', placeItems: 'center', padding: 'var(--space-4)', background: 'rgba(26,21,18,.5)' }}
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: 'min(80vh, 100%)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-card)',
          borderRadius: 'var(--radius-lg, 14px)',
          boxShadow: '0 12px 40px rgba(26,21,18,.35)',
          overflow: 'hidden',
        }}
      >
        <h2 id={idTitulo} style={{ margin: 0, padding: 'var(--space-5) var(--space-6) var(--space-3)', font: 'var(--type-h3)', color: 'var(--text-strong)' }}>
          {titulo}
        </h2>
        <div style={{ padding: '0 var(--space-6) var(--space-4)', overflowY: 'auto', font: 'var(--type-body)', color: 'var(--text-body)' }}>{children}</div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            gap: 'var(--space-3)',
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--border-hairline)',
            background: 'var(--arena-100)',
          }}
        >
          {acciones}
        </div>
      </div>
    </div>,
    document.body,
  )
}
