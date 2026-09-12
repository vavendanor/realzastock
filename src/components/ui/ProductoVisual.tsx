import { Sofa } from 'lucide-react'
import { colorDeTapiz } from '../../lib/format'

export function ProductThumb({ color, size = 44 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--arena-200)',
        border: '1px solid var(--border-hairline)',
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
        color: colorDeTapiz(color),
      }}
    >
      <Sofa size={size * 0.5} />
    </span>
  )
}

export function ColorDot({ color, showLabel = true }: { color: string; showLabel?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        font: 'var(--type-caption)',
        color: 'var(--text-muted)',
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: colorDeTapiz(color),
          border: '1px solid rgba(58,42,29,.2)',
          flex: '0 0 auto',
        }}
      />
      {showLabel && color}
    </span>
  )
}
