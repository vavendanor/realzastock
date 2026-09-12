import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router-dom'

interface Item {
  label: string
  to?: string
}

export function Breadcrumb({ items }: { items: Item[] }) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-caption)', color: 'var(--text-muted)' }}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <ChevronRight size={13} />}
          {item.to ? <Link to={item.to}>{item.label}</Link> : <span style={{ color: 'var(--text-strong)' }}>{item.label}</span>}
        </Fragment>
      ))}
    </div>
  )
}
