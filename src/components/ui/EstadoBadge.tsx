import type { EstadoPedido } from '../../types'
import { ESTADO_LABEL } from '../../lib/pedidos'

const COLORES: Record<EstadoPedido, { bg: string; fg: string }> = {
  pendiente: { bg: 'var(--pedido-pendiente-soft)', fg: 'var(--pedido-pendiente)' },
  en_preparacion: { bg: 'var(--pedido-preparacion-soft)', fg: 'var(--cobre-700)' },
  despachado: { bg: 'var(--pedido-despachado-soft)', fg: 'var(--pedido-despachado)' },
  entregado: { bg: 'var(--pedido-entregado-soft)', fg: 'var(--pedido-entregado)' },
}

export function EstadoBadge({ estado }: { estado: EstadoPedido }) {
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
      {ESTADO_LABEL[estado]}
    </span>
  )
}
