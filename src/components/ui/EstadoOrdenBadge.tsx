import { ESTADO_ORDEN_LABEL } from '../../lib/ordenes'
import type { EstadoOrden } from '../../types'

/* Mismos colores que el estado de los pedidos manuales: gris al inicio, ámbar
   al estar listo para despachar, azul en camino y verde entregado. */
const COLORES: Record<EstadoOrden, { bg: string; fg: string }> = {
  por_fabricar: { bg: 'var(--pedido-pendiente-soft)', fg: 'var(--pedido-pendiente)' },
  fabricado: { bg: 'var(--pedido-preparacion-soft)', fg: 'var(--cobre-700)' },
  en_despacho: { bg: 'var(--pedido-despachado-soft)', fg: 'var(--pedido-despachado)' },
  entregado: { bg: 'var(--pedido-entregado-soft)', fg: 'var(--pedido-entregado)' },
}

export function EstadoOrdenBadge({ estado }: { estado: EstadoOrden }) {
  const color = COLORES[estado]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        background: color.bg,
        color: color.fg,
        borderRadius: 'var(--radius-pill)',
        padding: '4px 10px',
        font: 'var(--fw-bold) var(--text-body-xs)/1.3 var(--font-sans)',
        letterSpacing: '.02em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flex: '0 0 auto' }} />
      {ESTADO_ORDEN_LABEL[estado]}
    </span>
  )
}
