interface CasillaEtapaProps {
  etiqueta: string
  /* Texto para lectores de pantalla, p. ej. "B del pedido 1180-1". */
  descripcion: string
  marcada: boolean
  deshabilitada?: boolean
  onCambiar: (valor: boolean) => void
  /* Versión grande, con la etiqueta visible, para tocar con el dedo. */
  grande?: boolean
  /* La casilla tiene un cambio que todavía no se guardó: se destaca con un borde y
     un punto, para que se note que falta pulsar "Guardar". */
  pendiente?: boolean
  /* El cambio pendiente no se puede guardar (el mueble salió a despacho o el pedido
     fue cancelado): se marca en rojo. */
  problema?: boolean
}

/* Una casilla de etapa de fabricación (B, I, A, C o LISTO). Dentro de una fila
   clicable, detiene el clic para que marcarla no abra el detalle. */
export function CasillaEtapa({ etiqueta, descripcion, marcada, deshabilitada = false, onCambiar, grande = false, pendiente = false, problema = false }: CasillaEtapaProps) {
  const color = problema ? 'var(--state-danger)' : 'var(--action-accent)'
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      data-pendiente={pendiente ? 'si' : undefined}
      data-problema={problema ? 'si' : undefined}
      title={problema ? 'Este cambio no se puede guardar' : pendiente ? 'Cambio sin guardar' : undefined}
      style={{
        position: 'relative',
        display: grande ? 'flex' : 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        minHeight: grande ? 44 : 28,
        minWidth: grande ? 0 : 28,
        padding: grande ? '0 var(--space-3)' : 0,
        border: pendiente ? `2px solid ${color}` : grande ? `1px solid ${marcada ? 'var(--state-success)' : 'var(--border-default)'}` : 'none',
        borderRadius: 'var(--radius-sm)',
        background: problema ? 'var(--state-danger-soft)' : pendiente ? 'var(--state-warning-soft)' : grande && marcada ? 'var(--state-success-soft)' : 'transparent',
        font: 'var(--type-label)',
        color: 'var(--text-strong)',
        cursor: deshabilitada ? 'not-allowed' : 'pointer',
        opacity: deshabilitada ? 0.55 : 1,
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={marcada}
        disabled={deshabilitada}
        aria-label={`${descripcion}${problema ? ' (cambio que no se puede guardar)' : pendiente ? ' (cambio sin guardar)' : ''}`}
        onChange={(e) => onCambiar(e.target.checked)}
        style={{
          width: grande ? 22 : 18,
          height: grande ? 22 : 18,
          accentColor: 'var(--action-accent)',
          cursor: 'inherit',
          margin: 0,
        }}
      />
      {grande && <span>{etiqueta}</span>}
      {pendiente && (
        <span
          aria-hidden="true"
          style={{ position: 'absolute', top: -4, right: -4, width: 9, height: 9, borderRadius: '50%', background: color, border: '1.5px solid var(--surface-card)' }}
        />
      )}
    </label>
  )
}
