import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useState } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  variant?: 'ghost' | 'outline'
  size?: number
  children: ReactNode
}

export function IconButton({ label, variant = 'ghost', size = 34, children, style, ...rest }: IconButtonProps) {
  const [hover, setHover] = useState(false)

  return (
    <button
      aria-label={label}
      title={label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: size,
        height: size,
        display: 'inline-grid',
        placeItems: 'center',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        color: 'var(--text-body)',
        background: hover ? 'var(--action-ghost-hover)' : variant === 'outline' ? 'var(--surface-card)' : 'transparent',
        border: variant === 'outline' ? '1px solid var(--border-default)' : '1px solid transparent',
        transition: 'background var(--dur-fast) var(--ease-out)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
