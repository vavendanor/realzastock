import { TriangleAlert } from 'lucide-react'

interface StockLevelProps {
  value: number
  min?: number
  showBar?: boolean
}

export function StockLevel({ value, min = 5, showBar = true }: StockLevelProps) {
  const critico = value <= Math.max(1, Math.floor(min / 2))
  const bajo = !critico && value <= min
  const color = critico ? 'var(--state-danger)' : bajo ? 'var(--cobre-700)' : 'var(--text-strong)'
  const track = critico ? 'var(--state-danger-soft)' : bajo ? 'var(--state-warning-soft)' : 'var(--arena-300)'
  const pct = Math.max(6, Math.min(100, (value / Math.max(min * 4, 1)) * 100))

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
      {(critico || bajo) && <TriangleAlert size={14} color={color} />}
      <span className="rh-num" style={{ font: 'var(--type-numeric)', color, minWidth: 24, textAlign: 'right' }}>
        {value}
      </span>
      {showBar && (
        <span
          style={{
            width: 52,
            height: 6,
            borderRadius: 'var(--radius-pill)',
            background: track,
            overflow: 'hidden',
            display: 'inline-block',
          }}
        >
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${pct}%`,
              background: critico ? 'var(--state-danger)' : bajo ? 'var(--state-warning)' : 'var(--nogal-500)',
            }}
          />
        </span>
      )}
    </span>
  )
}
