import { Check, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ProductThumb } from '../components/ui/ProductoVisual'
import { Select } from '../components/ui/Select'
import { StockLevel } from '../components/ui/StockLevel'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { clp } from '../lib/format'
import { listarVariantes, STOCK_MINIMO_DEFAULT } from '../lib/inventario'
import { CANALES, etiquetaCanal, registrarVenta, ubicacionPorDefecto } from '../lib/ventas'
import type { CanalVenta, ProductoVariante, UbicacionStock } from '../types'

const UBICACIONES: { value: UbicacionStock; label: string }[] = [
  { value: 'bodega', label: 'Bodega' },
  { value: 'showroom', label: 'Showroom' },
]

export function VentaNueva() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()

  const [variantes, setVariantes] = useState<ProductoVariante[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [varianteId, setVarianteId] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [canal, setCanal] = useState<CanalVenta>('showroom')
  const [ubicacion, setUbicacion] = useState<UbicacionStock>('showroom')

  const [guardando, setGuardando] = useState(false)
  const [confirmada, setConfirmada] = useState<{ folio: string; total: number } | null>(null)

  useEffect(() => {
    const cargar = async () => {
      setCargando(true)
      setError(null)
      try {
        const datos = await listarVariantes()
        setVariantes(datos)
        if (datos.length > 0) setVarianteId(datos[0].id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo')
      } finally {
        setCargando(false)
      }
    }
    void cargar()
  }, [])

  const variante = useMemo(() => variantes.find((v) => v.id === varianteId) ?? null, [variantes, varianteId])

  /* "Canal" y "Sale de" son dos campos independientes, y ambos partían en
     'showroom' por defecto: si el stock real estaba en bodega, la tarjeta
     mostraba "Stock en showroom: 0" y parecía que no se podía vender nada,
     cuando el campo "Sale de" simplemente no se había tocado. Al elegir una
     variante, se salta solo a la ubicación donde sí hay stock. Si el
     vendedor la cambia a mano después, esto no se lo vuelve a pisar porque
     solo depende del id de la variante, no de `ubicacion`. */
  useEffect(() => {
    if (!variante) return
    const stockAquí = ubicacion === 'bodega' ? variante.stockBodega : variante.stockShowroom
    if (stockAquí > 0) return
    const stockAllá = ubicacion === 'bodega' ? variante.stockShowroom : variante.stockBodega
    if (stockAllá > 0) setUbicacion(ubicacion === 'bodega' ? 'showroom' : 'bodega')
    // Solo depende del id de la variante a propósito: no debe repetirse
    // cada vez que `ubicacion` cambia, o pisaría la elección manual.
  }, [variante?.id])

  const disponible = variante ? (ubicacion === 'bodega' ? variante.stockBodega : variante.stockShowroom) : 0
  const total = variante ? variante.precio * cantidad : 0
  const excedeStock = cantidad > disponible

  /* Cambiar el canal reposiciona la ubicación sugerida, pero se puede
     corregir después: una venta online puede salir del showroom. */
  const cambiarCanal = (nuevo: CanalVenta) => {
    setCanal(nuevo)
    setUbicacion(ubicacionPorDefecto(nuevo))
  }

  const confirmar = async () => {
    if (!variante) return
    setError(null)
    setGuardando(true)

    try {
      const ventaId = await registrarVenta(canal, ubicacion, [{ variante_id: variante.id, cantidad }])
      setConfirmada({ folio: ventaId.slice(0, 8).toUpperCase(), total })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la venta')
    } finally {
      setGuardando(false)
    }
  }

  const registrarOtra = async () => {
    setConfirmada(null)
    setCantidad(1)
    /* El stock cambió con la venta recién hecha: hay que releerlo o la
       siguiente validación usaría cifras viejas. */
    try {
      setVariantes(await listarVariantes())
    } catch {
      /* Si falla la recarga, la función RPC igual rechaza el sobreventa. */
    }
  }

  if (confirmada) {
    return (
      <Shell eyebrow="COMERCIAL" title="Venta registrada">
        <Card>
          <div style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-4)' }}>
            <span
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'var(--state-success-soft)',
                color: 'var(--state-success)',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto var(--space-4)',
              }}
            >
              <Check size={30} />
            </span>
            <div style={{ font: 'var(--fw-medium) 24px/1.2 var(--font-display)', color: 'var(--text-strong)' }}>
              Folio {confirmada.folio}
            </div>
            <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
              {clp(confirmada.total)} · {etiquetaCanal(canal)}
              <br />
              Se descontaron {cantidad} {cantidad === 1 ? 'unidad' : 'unidades'} de {ubicacion}.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: esEscritorio ? 'row' : 'column', gap: 'var(--space-3)' }}>
            <Button size={esEscritorio ? 'md' : 'touch'} fullWidth onClick={() => void registrarOtra()}>
              Registrar otra venta
            </Button>
            <Button
              size={esEscritorio ? 'md' : 'touch'}
              variant="secondary"
              fullWidth
              onClick={() => navigate('/ventas')}
            >
              Ver historial
            </Button>
          </div>
        </Card>
      </Shell>
    )
  }

  const detalle = (
    <Card title="Detalle de la venta">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esEscritorio ? '1fr 1fr' : '1fr',
          gap: 'var(--space-4)',
        }}
      >
        <Select
          label="Variante"
          size={esEscritorio ? 'md' : 'touch'}
          value={varianteId}
          onChange={(e) => setVarianteId(e.target.value)}
          options={variantes.map((v) => ({
            value: v.id,
            label: `${v.modelo} · ${v.material} · ${v.color}`,
          }))}
          wrapperStyle={esEscritorio ? { gridColumn: 'span 2' } : undefined}
        />

        <div>
          <div style={{ font: 'var(--type-label)', color: 'var(--text-strong)', marginBottom: 'var(--space-2)' }}>
            Cantidad
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button
              type="button"
              onClick={() => setCantidad((c) => Math.max(1, c - 1))}
              aria-label="Quitar una unidad"
              style={{
                width: esEscritorio ? 40 : 56,
                height: esEscritorio ? 40 : 56,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Minus size={esEscritorio ? 18 : 22} />
            </button>
            <span
              className="rh-num"
              style={{
                flex: 1,
                textAlign: 'center',
                font: `var(--fw-medium) ${esEscritorio ? '24px' : '30px'}/1 var(--font-display)`,
                color: 'var(--text-strong)',
              }}
            >
              {cantidad}
            </span>
            <button
              type="button"
              onClick={() => setCantidad((c) => c + 1)}
              aria-label="Agregar una unidad"
              style={{
                width: esEscritorio ? 40 : 56,
                height: esEscritorio ? 40 : 56,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Plus size={esEscritorio ? 18 : 22} />
            </button>
          </div>
        </div>

        <Select
          label="Sale de"
          hint="Dónde está físicamente el producto que vendes"
          size={esEscritorio ? 'md' : 'touch'}
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value as UbicacionStock)}
          options={UBICACIONES}
        />

        <Select
          label="Canal"
          size={esEscritorio ? 'md' : 'touch'}
          value={canal}
          onChange={(e) => cambiarCanal(e.target.value as CanalVenta)}
          options={CANALES}
          wrapperStyle={esEscritorio ? { gridColumn: 'span 2' } : undefined}
        />
      </div>

      {variante && (
        <div
          style={{
            marginTop: 'var(--space-5)',
            padding: 'var(--space-4)',
            background: 'var(--arena-100)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
          }}
        >
          <ProductThumb color={variante.color} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
              {variante.modelo} · {variante.color}
            </div>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
              {variante.material} · {variante.sku}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Stock en {ubicacion}</div>
            <StockLevel value={disponible} min={STOCK_MINIMO_DEFAULT} showBar={false} />
          </div>
        </div>
      )}

      {variante && excedeStock && (
        <p style={{ marginTop: 'var(--space-3)', font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
          La cantidad supera el stock disponible en {ubicacion} ({disponible}{' '}
          {disponible === 1 ? 'unidad' : 'unidades'}).
        </p>
      )}
    </Card>
  )

  const resumen = (
    <Card title="Resumen">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {[
          ['Precio unitario', variante ? clp(variante.precio) : '—'],
          ['Cantidad', String(cantidad)],
          ['Canal', etiquetaCanal(canal)],
          ['Sale de', ubicacion === 'bodega' ? 'Bodega' : 'Showroom'],
        ].map(([clave, valor]) => (
          <div key={clave} style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--type-body)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{clave}</span>
            <span className="rh-num" style={{ color: 'var(--text-strong)' }}>
              {valor}
            </span>
          </div>
        ))}

        <div
          style={{
            borderTop: '1px solid var(--border-hairline)',
            paddingTop: 'var(--space-3)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <span style={{ font: 'var(--type-label)', color: 'var(--text-strong)' }}>Total</span>
          <span
            className="rh-num"
            style={{ font: 'var(--fw-medium) 28px/1 var(--font-display)', color: 'var(--text-strong)' }}
          >
            {clp(total)}
          </span>
        </div>

        <Button
          size={esEscritorio ? 'lg' : 'touch'}
          variant="accent"
          fullWidth
          disabled={!variante || excedeStock || guardando || cargando}
          onClick={() => void confirmar()}
          iconLeft={<Check size={17} />}
        >
          {guardando ? 'Registrando...' : 'Confirmar venta'}
        </Button>

        <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          Al confirmar se descuenta el stock de {ubicacion} y la venta queda en el historial. Si el stock no
          alcanza, no se registra nada.
        </p>
      </div>
    </Card>
  )

  return (
    <Shell
      eyebrow="COMERCIAL"
      title="Registrar venta"
      actions={
        esEscritorio ? (
          <Button variant="secondary" onClick={() => navigate('/ventas')}>
            Cancelar
          </Button>
        ) : null
      }
    >
      {esEscritorio && <Breadcrumb items={[{ label: 'Ventas', to: '/ventas' }, { label: 'Nueva venta' }]} />}

      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      {cargando ? (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando catálogo...</span>
        </Card>
      ) : variantes.length === 0 ? (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>
            No hay productos en el catálogo todavía. Pídele a un administrador que cargue el inventario.
          </span>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: esEscritorio ? '1.2fr .8fr' : '1fr',
            gap: esEscritorio ? 'var(--space-5)' : 'var(--space-4)',
            alignItems: 'start',
          }}
        >
          {detalle}
          {resumen}
        </div>
      )}
    </Shell>
  )
}
