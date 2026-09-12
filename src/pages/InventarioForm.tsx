import { Check, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DataTable, type Column } from '../components/ui/DataTable'
import { ColorDot } from '../components/ui/ProductoVisual'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { StockLevel } from '../components/ui/StockLevel'
import { clp, TAPICES } from '../lib/format'
import {
  actualizarVariante,
  crearProductoConVariante,
  eliminarVariante,
  listarVariantesDeProducto,
  obtenerVariante,
  STOCK_MINIMO_DEFAULT,
  type DatosVariante,
} from '../lib/inventario'
import type { ProductoVariante } from '../types'

const MATERIALES = ['Lino hidrorepelente', '30% cuero natural']
const COLORES = Object.keys(TAPICES)

const VACIO: DatosVariante = {
  modelo: '',
  descripcion: '',
  color: COLORES[0],
  material: MATERIALES[0],
  sku: '',
  precio: 0,
  stockBodega: 0,
  stockShowroom: 0,
}

/* Si el registro guardado tiene un valor que no está en la lista del catálogo,
   se agrega como opción para no cambiarlo en silencio al abrir el formulario. */
function conValorActual(opciones: string[], actual: string) {
  return opciones.includes(actual) ? opciones : [actual, ...opciones]
}

export function InventarioForm() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const esNuevo = id === undefined

  const [datos, setDatos] = useState<DatosVariante>(VACIO)
  const [productoId, setProductoId] = useState<string | null>(null)
  const [hermanas, setHermanas] = useState<ProductoVariante[]>([])
  const [cargando, setCargando] = useState(!esNuevo)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (esNuevo) return

    const cargar = async () => {
      setCargando(true)
      setError(null)
      try {
        const variante = await obtenerVariante(id)
        setProductoId(variante.productoId)
        setDatos({
          modelo: variante.modelo,
          descripcion: variante.descripcion ?? '',
          color: variante.color,
          material: variante.material,
          sku: variante.sku,
          precio: variante.precio,
          stockBodega: variante.stockBodega,
          stockShowroom: variante.stockShowroom,
        })
        const todas = await listarVariantesDeProducto(variante.productoId)
        setHermanas(todas.filter((v) => v.id !== variante.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar la variante')
      } finally {
        setCargando(false)
      }
    }

    void cargar()
  }, [id, esNuevo])

  const actualizar = <K extends keyof DatosVariante>(campo: K, valor: DatosVariante[K]) =>
    setDatos((previo) => ({ ...previo, [campo]: valor }))

  const guardar = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setGuardando(true)

    try {
      if (esNuevo) {
        await crearProductoConVariante(datos)
      } else {
        await actualizarVariante(id, productoId!, datos)
      }
      navigate('/inventario')
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudo guardar'
      /* El SKU tiene un unique en la BD; el mensaje crudo de Postgres no le
         dice nada útil a quien está cargando productos. */
      setError(mensaje.includes('duplicate key') ? `El SKU "${datos.sku}" ya existe en otra variante.` : mensaje)
    } finally {
      setGuardando(false)
    }
  }

  const borrar = async () => {
    if (!id) return

    /* Sin variantes hermanas, borrar esta arrastra también al producto:
       conviene decirlo antes y no después. */
    const esUltima = hermanas.length === 0
    const aviso = esUltima
      ? `¿Eliminar la variante ${datos.sku}? Es la única variante de "${datos.modelo}", así que también se eliminará el producto. Esta acción no se puede deshacer.`
      : `¿Eliminar la variante ${datos.sku}? Esta acción no se puede deshacer.`

    if (!confirm(aviso)) return

    setGuardando(true)
    try {
      await eliminarVariante(id)
      navigate('/inventario')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar')
      setGuardando(false)
    }
  }

  const columnasHermanas: Column<ProductoVariante>[] = [
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
        <span className="rh-num" style={{ font: 'var(--type-numeric)' }}>
          {clp(r.precio)}
        </span>
      ),
    },
    {
      key: 'bodega',
      header: 'Bodega',
      align: 'right',
      render: (r) => <StockLevel value={r.stockBodega} min={STOCK_MINIMO_DEFAULT} showBar={false} />,
    },
  ]

  return (
    <Shell
      eyebrow="INVENTARIO"
      title={esNuevo ? 'Nuevo producto' : 'Editar variante'}
      actions={
        <>
          <Button variant="secondary" onClick={() => navigate('/inventario')} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="form-inventario"
            iconLeft={<Check size={16} />}
            disabled={guardando || cargando}
          >
            {guardando ? 'Guardando...' : esNuevo ? 'Crear producto' : 'Guardar cambios'}
          </Button>
        </>
      }
    >
      <Breadcrumb
        items={[{ label: 'Inventario', to: '/inventario' }, { label: esNuevo ? 'Nuevo producto' : datos.sku || 'Variante' }]}
      />

      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      {cargando ? (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando variante...</span>
        </Card>
      ) : (
        <form id="form-inventario" onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <Card title="Producto" subtitle="Datos compartidos por todas las variantes de este modelo">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <Input
                label="Modelo"
                required
                value={datos.modelo}
                onChange={(e) => actualizar('modelo', e.target.value)}
                placeholder="Sofá Valencia"
                wrapperStyle={{ gridColumn: 'span 2' }}
              />
              <Input
                label="Descripción"
                value={datos.descripcion}
                onChange={(e) => actualizar('descripcion', e.target.value)}
                placeholder="210 × 88 × 85 cm · 6 meses de garantía"
                hint="Opcional. Medidas, garantía u otra ficha breve."
                wrapperStyle={{ gridColumn: 'span 2' }}
              />
            </div>
          </Card>

          <Card title="Variante" subtitle="Material, color, precio y stock por ubicación">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
              <Select
                label="Material"
                value={datos.material}
                onChange={(e) => actualizar('material', e.target.value)}
                options={conValorActual(MATERIALES, datos.material)}
              />
              <Select
                label="Color"
                value={datos.color}
                onChange={(e) => actualizar('color', e.target.value)}
                options={conValorActual(COLORES, datos.color)}
              />
              <Input
                label="SKU"
                required
                value={datos.sku}
                onChange={(e) => actualizar('sku', e.target.value.toUpperCase())}
                placeholder="RH-VAL-LIN-GRS"
              />
              <Input
                label="Precio"
                type="number"
                min={0}
                required
                value={datos.precio}
                onChange={(e) => actualizar('precio', Number(e.target.value))}
                suffix="CLP"
              />
              <Input
                label="Stock bodega"
                type="number"
                min={0}
                value={datos.stockBodega}
                onChange={(e) => actualizar('stockBodega', Number(e.target.value))}
                suffix="unid."
              />
              <Input
                label="Stock showroom"
                type="number"
                min={0}
                value={datos.stockShowroom}
                onChange={(e) => actualizar('stockShowroom', Number(e.target.value))}
                suffix="unid."
              />
            </div>
          </Card>

          {!esNuevo && hermanas.length > 0 && (
            <Card padding="0" title="Otras variantes de este modelo" subtitle={datos.modelo}>
              <DataTable
                rows={hermanas}
                columns={columnasHermanas}
                onRowClick={(r) => navigate(`/inventario/${r.id}`)}
              />
            </Card>
          )}

          {!esNuevo && (
            <Card title="Zona de riesgo" subtitle="La eliminación borra también el stock asociado">
              <Button type="button" variant="danger" iconLeft={<Trash2 size={16} />} onClick={() => void borrar()} disabled={guardando}>
                Eliminar variante
              </Button>
            </Card>
          )}
        </form>
      )}
    </Shell>
  )
}
