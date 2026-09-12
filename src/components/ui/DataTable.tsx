import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

export interface Column<T> {
  key: string
  header: ReactNode
  align?: 'left' | 'right' | 'center'
  width?: string
  render?: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  onRowClick?: (row: T) => void
  emptyLabel?: ReactNode
  style?: CSSProperties
}

export function DataTable<T extends { id?: string }>({
  columns,
  rows,
  onRowClick,
  emptyLabel = 'Sin resultados',
  style,
}: DataTableProps<T>) {
  const [hoverRow, setHoverRow] = useState(-1)

  return (
    <div style={{ overflowX: 'auto', ...style }}>
      <table style={{ minWidth: 'max-content' }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  textAlign: column.align ?? 'left',
                  padding: 'var(--space-3) var(--space-5)',
                  background: 'var(--arena-100)',
                  borderBottom: '1px solid var(--border-default)',
                  font: 'var(--fw-bold) var(--text-eyebrow)/1.2 var(--font-sans)',
                  letterSpacing: 'var(--ls-eyebrow)',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  width: column.width,
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: 'var(--space-10)',
                  textAlign: 'center',
                  font: 'var(--type-body)',
                  color: 'var(--text-muted)',
                }}
              >
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr
              key={row.id ?? index}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onMouseEnter={() => setHoverRow(index)}
              onMouseLeave={() => setHoverRow(-1)}
              style={{
                background: hoverRow === index ? 'var(--arena-100)' : 'var(--surface-card)',
                cursor: onRowClick ? 'pointer' : 'default',
                transition: 'background var(--dur-fast) var(--ease-out)',
              }}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  style={{
                    textAlign: column.align ?? 'left',
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: '1px solid var(--border-hairline)',
                    font: 'var(--type-body)',
                    color: 'var(--text-body)',
                    verticalAlign: 'middle',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {column.render ? column.render(row) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
