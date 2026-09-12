import { Pencil, Plus, RotateCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Checkbox } from '../components/ui/Checkbox'
import { DataTable, type Column } from '../components/ui/DataTable'
import { IconButton } from '../components/ui/IconButton'
import { ColorDot, ProductThumb } from '../components/ui/ProductoVisual'
import { Select } from '../components/ui/Select'
import { StockLevel } from '../components/ui/StockLevel'
import { clp } from '../lib/format'
import { listarVariantes, STOCK_MINIMO_DEFAULT } from '../lib/inventario'
import type { ProductoVariante } from '../types'

const TODOS_MODELOS = 'Todos los modelos'
const TODOS_MATERIALES = 'Todos los materiales'

export function Inventario() {
  const navigate = useNavigate()
  const [variantes, setVariantes] = useState<ProductoVariante[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [busqueda, setBusqueda] = useState('')
  const [modelo, setModelo] = useState(TODOS_MODELOS)
  const [material, setMaterial] = useState(TODOS_MATERIALES)
  const [soloBajo, setSoloBajo] = useState(false)

  const cargar = async () => {
    setCargando(true)
    setError(null)
    try {
      setVariantes(await listarVariantes())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar el inventario')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    void cargar()
  }, [])

  /* Los filtros se arman con los valores que realmente existen en la BD,
     no con una lista fija: así aparecen solos los modelos nuevos. */
  const modelos = useMemo(
    () => [TODOS_MODELOS, ...Array.from(new Set(variantes.map((v) => v.modelo))).sort()],
    [variantes],
  )
  const materiales = useMemo(
    () => [TODOS_MATERIALES, ...Array.from(new Set(variantes.map((v) => v.material))).sort()],
    [variantes],
  )

  const filas = useMemo(
    () =>
      variantes.filter((v) => {
        const texto = `${v.modelo}${v.sku}${v.color}${v.material}`.toLowerCase()
        if (busqueda && !texto.includes(busqueda.toLowerCase())) return false
        if (modelo !== TODOS_MODELOS && v.modelo !== modelo) return false
        if (material !== TODOS_MATERIALES && v.material !== material) return false
        if (soloBajo && v.stockBodega + v.stockShowroom > STOCK_MINIMO_DEFAULT) return false
        return true
      }),
    [variantes, busqueda, modelo, material, soloBajo],
  )

  const columnas: Column<ProductoVariante>[] = [
    {
      key: 'modelo',
      header: 'Modelo',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <ProductThumb color={r.color} />
          <div>
            <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{r.modelo}</div>
            {r.descripcion && (
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{r.descripcion}</div>
            )}
          </div>
        </div>
      ),
    },
    { key: 'material', header: 'Material', render: (r) => <span>{r.material}</span> },
    { key: 'color', header: 'Color', render: (r) => <ColorDot color={r.color} /> },
    {
      key: 'sku',
      header: 'SKU',
      render: (r) => <span style={{ font: 'var(--type-numeric)', color: 'var(--text-muted)' }}>{r.sku}</span>,
    },
    {
      key: 'precio',
      header: 'Precio',
      align: 'right',
      render: (r) => (
        <span className="rh-num" style={{ font: 'var(--type-numeric)', color: 'var(--text-strong)' }}>
          {clp(r.precio)}
        </span>
      ),
    },
    {
      key: 'bodega',
      header: 'Stock bodega',
      align: 'right',
      render: (r) => <StockLevel value={r.stockBodega} min={STOCK_MINIMO_DEFAULT} />,
    },
    {
      key: 'showroom',
      header: 'Showroom',
      align: 'right',
      render: (r) => <StockLevel value={r.stockShowroom} min={2} showBar={false} />,
    },
    {
      key: 'acciones',
      header: '',
      align: 'right',
      width: '64px',
      render: (r) => (
        <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
          <IconButton label="Editar" variant="outline" onClick={() => navigate(`/inventario/${r.id}`)}>
            <Pencil size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  const subtitulo = cargando
    ? 'Cargando...'
    : `${filas.length} de ${variantes.length} ${variantes.length === 1 ? 'variante' : 'variantes'}`

  return (
    <Shell
      eyebrow="CATÁLOGO"
      title="Inventario"
      onSearch={setBusqueda}
      actions={
        <>
          <IconButton label="Recargar" variant="outline" onClick={() => void cargar()}>
            <RotateCw size={15} />
          </IconButton>
          <Button iconLeft={<Plus size={16} />} onClick={() => navigate('/inventario/nuevo')}>
            Nuevo producto
          </Button>
        </>
      }
    >
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            No se pudo cargar el inventario: {error}
          </span>
        </Card>
      )}

      <Card
        padding="0"
        title="Variantes"
        subtitle={subtitulo}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <Checkbox label="Solo stock bajo" checked={soloBajo} onChange={() => setSoloBajo(!soloBajo)} />
            <Select
              size="sm"
              value={modelo}
              onChange={(e) => setModelo(e.target.value)}
              options={modelos}
              wrapperStyle={{ width: 200 }}
            />
            <Select
              size="sm"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              options={materiales}
              wrapperStyle={{ width: 200 }}
            />
          </div>
        }
      >
        <DataTable
          rows={filas}
          columns={columnas}
          onRowClick={(r) => navigate(`/inventario/${r.id}`)}
          emptyLabel={
            cargando
              ? 'Cargando inventario...'
              : variantes.length === 0
                ? 'Todavía no hay productos cargados. Usa "Nuevo producto" para crear el primero.'
                : 'Ninguna variante coincide con los filtros'
          }
        />
      </Card>
    </Shell>
  )
}
