import type { InputHTMLAttributes } from 'react'
import { useId } from 'react'

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
}

export function Checkbox({ label, id, ...rest }: CheckboxProps) {
  const generatedId = useId()
  const checkboxId = id ?? generatedId

  return (
    <label
      htmlFor={checkboxId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        font: 'var(--type-body)',
        fontSize: 'var(--text-body-sm)',
        color: 'var(--text-body)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <input
        id={checkboxId}
        type="checkbox"
        style={{ width: 16, height: 16, accentColor: 'var(--action-accent)', cursor: 'pointer' }}
        {...rest}
      />
      {label}
    </label>
  )
}
