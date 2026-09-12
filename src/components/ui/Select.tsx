import type { CSSProperties, SelectHTMLAttributes } from 'react'
import { useId, useState } from 'react'

export type SelectOption = string | { value: string; label: string }

/* Se omite `size` nativo (numérico en HTML) para reutilizar el nombre
   con la escala de tamaños del sistema de diseño. */
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string
  hint?: string
  options: SelectOption[]
  size?: 'sm' | 'md' | 'touch'
  wrapperStyle?: CSSProperties
}

export function Select({ label, hint, options, size = 'md', id, wrapperStyle, ...rest }: SelectProps) {
  const [focus, setFocus] = useState(false)
  const generatedId = useId()
  const selectId = id ?? generatedId
  const alto = size === 'touch' ? 'var(--control-h-touch)' : size === 'sm' ? 'var(--control-h-sm)' : 'var(--control-h-md)'

  return (
    <label
      htmlFor={selectId}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...wrapperStyle }}
    >
      {label && <span style={{ font: 'var(--type-label)', color: 'var(--text-strong)' }}>{label}</span>}
      <select
        id={selectId}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          height: alto,
          padding: '0 var(--space-3)',
          paddingRight: '34px',
          background: 'var(--surface-card)',
          border: `1px solid ${focus ? 'var(--border-focus)' : 'var(--border-default)'}`,
          boxShadow: focus ? 'var(--shadow-focus)' : 'none',
          borderRadius: 'var(--radius-sm)',
          font: 'var(--type-body)',
          color: 'var(--text-strong)',
          appearance: 'none',
          outline: 'none',
          cursor: 'pointer',
          backgroundImage:
            'linear-gradient(45deg,transparent 50%,var(--text-muted) 50%),linear-gradient(135deg,var(--text-muted) 50%,transparent 50%)',
          backgroundPosition: 'calc(100% - 18px) 55%,calc(100% - 13px) 55%',
          backgroundSize: '5px 5px,5px 5px',
          backgroundRepeat: 'no-repeat',
        }}
        {...rest}
      >
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value
          const label = typeof option === 'string' ? option : option.label
          return (
            <option key={value} value={value}>
              {label}
            </option>
          )
        })}
      </select>
      {hint && <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{hint}</span>}
    </label>
  )
}
