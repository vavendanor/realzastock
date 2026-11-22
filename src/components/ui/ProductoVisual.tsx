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
