import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg' | 'touch'

const variantes: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--action-primary)', color: 'var(--text-invert)', border: '1px solid var(--action-primary)' },
  accent: { background: 'var(--action-accent)', color: 'var(--text-invert)', border: '1px solid var(--action-accent)' },
  secondary: { background: 'var(--surface-card)', color: 'var(--text-strong)', border: '1px solid var(--border-default)' },
  ghost: { background: 'transparent', color: 'var(--text-body)', border: '1px solid transparent' },
  danger: { background: 'var(--state-danger)', color: 'var(--text-invert)', border: '1px solid var(--state-danger)' },
}

const hoverVariantes: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--action-primary-hover)', borderColor: 'var(--action-primary-hover)' },
  accent: { background: 'var(--action-accent-hover)', borderColor: 'var(--action-accent-hover)' },
  secondary: { background: 'var(--arena-200)', borderColor: 'var(--border-strong)' },
  ghost: { background: 'var(--action-ghost-hover)' },
  danger: { filter: 'brightness(.92)' },
}

const tamanos: Record<Size, CSSProperties> = {
  sm: { height: 'var(--control-h-sm)', padding: '0 var(--space-3)', fontSize: 'var(--text-body-sm)' },
  md: { height: 'var(--control-h-md)', padding: '0 var(--space-5)', fontSize: 'var(--text-body-md)' },
  lg: { height: 'var(--control-h-lg)', padding: '0 var(--space-6)', fontSize: 'var(--text-body-md)' },
  touch: { height: 'var(--control-h-touch)', padding: '0 var(--space-6)', fontSize: 'var(--text-body-lg)' },
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  children,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false)
  const [press, setPress] = useState(false)

  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--fw-semibold)',
    letterSpacing: '.01em',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition:
      'background var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out)',
    width: fullWidth ? '100%' : 'auto',
  }

  const estiloDeshabilitado: CSSProperties = {
    background: 'var(--action-disabled)',
    borderColor: 'var(--action-disabled)',
    color: 'var(--action-disabled-text)',
    cursor: 'not-allowed',
  }

  return (
    <button
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false)
        setPress(false)
      }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        ...base,
        ...tamanos[size],
        ...variantes[variant],
        ...(hover && !disabled ? hoverVariantes[variant] : null),
        ...(press && !disabled ? { transform: 'scale(.985)' } : null),
        ...(disabled ? estiloDeshabilitado : null),
        ...style,
      }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  )
}
