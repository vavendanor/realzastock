interface CasillaEtapaProps {
  etiqueta: string
  /* Texto para lectores de pantalla, p. ej. "B del pedido 1180-1". */
  descripcion: string
  marcada: boolean
  deshabilitada?: boolean
  onCambiar: (valor: boolean) => void
  /* Versión grande, con la etiqueta visible, para tocar con el dedo. */
  grande?: boolean
}

/* Una casilla de etapa de fabricación (B, I, A, C o LISTO). Dentro de una fila
   clicable, detiene el clic para que marcarla no abra el detalle. */
export function CasillaEtapa({ etiqueta, descripcion, marcada, deshabilitada = false, onCambiar, grande = false }: CasillaEtapaProps) {
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      style={{
        display: grande ? 'flex' : 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        minHeight: grande ? 44 : 28,
        minWidth: grande ? 0 : 28,
        padding: grande ? '0 var(--space-3)' : 0,
        border: grande ? `1px solid ${marcada ? 'var(--state-success)' : 'var(--border-default)'}` : 'none',
        borderRadius: 'var(--radius-sm)',
        background: grande && marcada ? 'var(--state-success-soft)' : 'transparent',
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
        aria-label={descripcion}
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
    </label>
  )
}
