import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

type Tone = 'neutral' | 'danger' | 'warning' | 'success'

const TONOS: Record<Tone, { accent: string; soft: string }> = {
  neutral: { accent: 'var(--nogal-700)', soft: 'var(--arena-300)' },
  danger: { accent: 'var(--state-danger)', soft: 'var(--state-danger-soft)' },
  warning: { accent: 'var(--cobre-700)', soft: 'var(--state-warning-soft)' },
  success: { accent: 'var(--state-success)', soft: 'var(--state-success-soft)' },
}

interface KpiCardProps {
  label: string
  value: ReactNode
  unit?: string
  icon: ReactNode
  tone?: Tone
  delta?: string
  footnote?: string
  onClick?: () => void
  style?: CSSProperties
}

export function KpiCard({ label, value, unit, icon, tone = 'neutral', delta, footnote, onClick, style }: KpiCardProps) {
  const [hover, setHover] = useState(false)
  const t = TONOS[tone]

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        boxShadow: hover && onClick ? 'var(--shadow-raised)' : 'var(--shadow-card)',
        transform: hover && onClick ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <span style={{ font: 'var(--type-label)', color: 'var(--text-muted)' }}>{label}</span>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--radius-sm)',
            background: t.soft,
            display: 'grid',
            placeItems: 'center',
            color: t.accent,
            flex: '0 0 auto',
          }}
        >
          {icon}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
        <span
          className="rh-num"
          style={{ font: 'var(--fw-medium) 34px/1 var(--font-display)', color: 'var(--text-strong)', letterSpacing: 'var(--ls-display)' }}
        >
          {value}
        </span>
        {unit && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', paddingBottom: 4 }}>{unit}</span>}
      </div>

      {(delta || footnote) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          {delta && <span style={{ color: t.accent, fontWeight: 'var(--fw-bold)' }}>{delta}</span>}
          {footnote}
        </div>
      )}
    </div>
  )
}
