import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'

type Tone = 'card' | 'sunken' | 'brand'

const tonos: Record<Tone, CSSProperties> = {
  card: { background: 'var(--surface-card)' },
  sunken: { background: 'var(--arena-100)' },
  brand: { background: 'var(--surface-brand)', color: 'var(--text-invert)' },
}

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  padding?: string
  tone?: Tone
  children?: ReactNode
}

export function Card({
  title,
  subtitle,
  actions = null,
  padding = 'var(--space-6)',
  tone = 'card',
  children,
  style,
  ...rest
}: CardProps) {
  return (
    <section
      style={{
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-card)',
        overflow: 'hidden',
        ...tonos[tone],
        ...style,
      }}
      {...rest}
    >
      {(title || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            padding: 'var(--space-5) var(--space-6)',
            borderBottom: '1px solid var(--border-hairline)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {title && (
              <h3
                style={{
                  font: 'var(--type-h3)',
                  fontSize: '18px',
                  color: tone === 'brand' ? 'var(--text-invert)' : 'var(--text-strong)',
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{subtitle}</span>}
          </div>
          {actions}
        </header>
      )}
      <div style={{ padding }}>{children}</div>
    </section>
  )
}
