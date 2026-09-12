import type { CSSProperties, InputHTMLAttributes, ReactNode } from 'react'
import { useId, useState } from 'react'

/* Se omite `size` nativo (numérico en HTML) para reutilizar el nombre
   con la escala de tamaños del sistema de diseño. */
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string
  hint?: string
  error?: string
  iconLeft?: ReactNode
  suffix?: ReactNode
  size?: 'sm' | 'md' | 'touch'
  wrapperStyle?: CSSProperties
}

export function Input({
  label,
  hint,
  error,
  iconLeft = null,
  suffix = null,
  size = 'md',
  id,
  wrapperStyle,
  ...rest
}: InputProps) {
  const [focus, setFocus] = useState(false)
  const generatedId = useId()
  const inputId = id ?? generatedId
  const alto = size === 'touch' ? 'var(--control-h-touch)' : size === 'sm' ? 'var(--control-h-sm)' : 'var(--control-h-md)'

  return (
    <label
      htmlFor={inputId}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...wrapperStyle }}
    >
      {label && <span style={{ font: 'var(--type-label)', color: 'var(--text-strong)' }}>{label}</span>}
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          height: alto,
          padding: '0 var(--space-3)',
          background: 'var(--surface-card)',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${error ? 'var(--state-danger)' : focus ? 'var(--border-focus)' : 'var(--border-default)'}`,
          boxShadow: focus ? 'var(--shadow-focus)' : 'none',
          transition: 'border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out)',
        }}
      >
        {iconLeft && <span style={{ color: 'var(--text-faint)', display: 'flex' }}>{iconLeft}</span>}
        <input
          id={inputId}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            font: 'var(--type-body)',
            color: 'var(--text-strong)',
          }}
          {...rest}
        />
        {suffix && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{suffix}</span>}
      </span>
      {(error || hint) && (
        <span style={{ font: 'var(--type-caption)', color: error ? 'var(--state-danger)' : 'var(--text-muted)' }}>
          {error || hint}
        </span>
      )}
    </label>
  )
}
