import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TAMANOS_DE_PAGINA, type Pagina } from '../../lib/paginar'
import { Button } from './Button'
import { Select } from './Select'

interface Props {
  /* La página que se muestra (de paginar()); el paginador no guarda estado propio. */
  pagina: Pick<Pagina<unknown>, 'pagina' | 'paginas' | 'desde' | 'hasta' | 'total'>
  porPagina: number
  alCambiarPagina: (pagina: number) => void
  alCambiarPorPagina: (porPagina: number) => void
  /* "muebles", "órdenes"... para leer "Mostrando 1–20 de 95 muebles". */
  unidad: string
}

/* "Mostrando 21–40 de 95", selector de cuántos por página (20, 50 o 100) y botones Anterior/Siguiente. */
export function Paginador({ pagina, porPagina, alCambiarPagina, alCambiarPorPagina, unidad }: Props) {
  if (pagina.total === 0) return null
  return (
    <nav
      aria-label="Paginador"
      data-paginador
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap', padding: 'var(--space-3) var(--space-4)' }}
    >
      <span aria-live="polite" data-rango style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>
        Mostrando {pagina.desde}–{pagina.hasta} de {pagina.total} {unidad}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Select
          aria-label="Por página"
          size="sm"
          value={String(porPagina)}
          onChange={(e) => alCambiarPorPagina(Number(e.target.value))}
          options={TAMANOS_DE_PAGINA.map((n) => ({ value: String(n), label: `${n} por página` }))}
        />
        <Button size="sm" variant="secondary" iconLeft={<ChevronLeft size={14} />} disabled={pagina.pagina <= 1} onClick={() => alCambiarPagina(pagina.pagina - 1)}>
          Anterior
        </Button>
        <span data-pagina style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          Página {pagina.pagina} de {pagina.paginas}
        </span>
        <Button size="sm" variant="secondary" iconRight={<ChevronRight size={14} />} disabled={pagina.pagina >= pagina.paginas} onClick={() => alCambiarPagina(pagina.pagina + 1)}>
          Siguiente
        </Button>
      </div>
    </nav>
  )
}
