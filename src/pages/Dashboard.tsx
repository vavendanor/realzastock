import { Banknote, TriangleAlert, Truck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DataTable, type Column } from '../components/ui/DataTable'
import { EstadoBadge } from '../components/ui/EstadoBadge'
import { KpiCard } from '../components/ui/KpiCard'
import { ColorDot, ProductThumb } from '../components/ui/ProductoVisual'
import { StockLevel } from '../components/ui/StockLevel'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { clp, hoy } from '../lib/format'
import { listarVariantes, STOCK_MINIMO_DEFAULT } from '../lib/inventario'
import { listarPedidos } from '../lib/pedidos'
import { listarVentas } from '../lib/ventas'
import type { Pedido, ProductoVariante } from '../types'

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-CL')
}

/* Pantalla de inicio del administrador. Es solo lectura: las cifras y
   listas de acá son un resumen para decidir qué revisar, no un punto de
   edición — para eso están Inventario, Ventas y Pedidos, un clic más allá. */
export function Dashboard() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()

  const [variantes, setVariantes] = useState<ProductoVariante[]>([])
  const [ventasHoy, setVentasHoy] = useState<{ total: number; cantidad: number }>({ total: 0, cantidad: 0 })
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cargar = async () => {
      setCargando(true)
      setError(null)
      try {
        const fechaHoy = hoy()
        const [datosVariantes, datosVentasHoy, datosPedidos] = await Promise.all([
          listarVariantes(),
          listarVentas({ desde: fechaHoy, hasta: fechaHoy }),
          listarPedidos(),
        ])
        setVariantes(datosVariantes)
        setVentasHoy({
          cantidad: datosVentasHoy.length,
          total: datosVentasHoy.reduce((suma, venta) => suma + venta.total, 0),
        })
        setPedidos(datosPedidos)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard')
      } finally {
        setCargando(false)
      }
    }
    void cargar()
  }, [])

  const todasLasBajas = variantes
    .filter((v) => v.stockBodega + v.stockShowroom <= STOCK_MINIMO_DEFAULT)
    .sort((a, b) => a.stockBodega + a.stockShowroom - (b.stockBodega + b.stockShowroom))
  /* El KPI muestra el total de variantes bajo el mínimo; la lista de abajo
     solo enseña las 5 más urgentes (menos stock primero). */
  const variantesBajas = todasLasBajas.slice(0, 5)

  const pedidosPendientes = pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'en_preparacion')
  const soloPendientes = pedidos.filter((p) => p.estado === 'pendiente')
  const ultimosPedidos = pedidos.slice(0, 5)

  const columnasStock: Column<ProductoVariante>[] = [
    {
      key: 'modelo',
      header: 'Variante',
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <ProductThumb color={r.color} size={36} />
          <div>
            <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{r.modelo}</div>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
              {r.material} · {r.color}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      render: (r) => <span style={{ font: 'var(--type-numeric)', color: 'var(--text-muted)' }}>{r.sku}</span>,
    },
    { key: 'bodega', header: 'Bodega', align: 'right', render: (r) => <StockLevel value={r.stockBodega} min={STOCK_MINIMO_DEFAULT} /> },
    { key: 'showroom', header: 'Showroom', align: 'right', render: (r) => <StockLevel value={r.stockShowroom} min={2} showBar={false} /> },
  ]

  const alertasStock = (
    <Card
      padding={esEscritorio ? '0' : undefined}
      title="Alertas de stock"
      subtitle="Las 5 variantes con menos unidades"
      actions={
        <Button size="sm" variant="secondary" onClick={() => navigate('/inventario')}>
          Ver inventario
        </Button>
      }
    >
      {esEscritorio ? (
        <DataTable
          rows={variantesBajas}
          columns={columnasStock}
          emptyLabel={cargando ? 'Cargando...' : 'Ningún producto está bajo el mínimo ahora mismo'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {!cargando && variantesBajas.length === 0 && (
            <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>
              Ningún producto está bajo el mínimo ahora mismo.
            </span>
          )}
          {variantesBajas.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <ProductThumb color={v.color} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{v.modelo}</div>
                <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                  <ColorDot color={v.color} /> · {v.material}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <StockLevel value={v.stockBodega + v.stockShowroom} min={STOCK_MINIMO_DEFAULT} showBar={false} />
                <div style={{ font: 'var(--type-caption)', color: 'var(--text-faint)' }}>total</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )

  const ultimos = (
    <Card
      title="Últimos pedidos"
      subtitle="Los 5 más recientes"
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate('/pedidos')}>
          Ver todos
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!cargando && ultimosPedidos.length === 0 && (
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Todavía no hay pedidos.</span>
        )}
        {ultimosPedidos.map((pedido, i) => (
          <div
            key={pedido.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) 0',
              borderTop: i ? '1px solid var(--border-hairline)' : 'none',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  font: 'var(--type-body-strong)',
                  color: 'var(--text-strong)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {pedido.clienteNombre}
              </div>
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                {formatearFecha(pedido.fechaCreacion)} · {pedido.unidades} {pedido.unidades === 1 ? 'unidad' : 'unidades'}
              </div>
            </div>
            <EstadoBadge estado={pedido.estado} />
          </div>
        ))}
      </div>
    </Card>
  )

  return (
    <Shell eyebrow="RESUMEN" title="Dashboard">
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esEscritorio ? 'repeat(3,1fr)' : '1fr',
          gap: esEscritorio ? 'var(--space-5)' : 'var(--space-3)',
        }}
      >
        <KpiCard
          label="Productos con stock bajo"
          value={cargando ? '—' : todasLasBajas.length}
          tone="danger"
          icon={<TriangleAlert size={16} />}
          footnote={cargando ? undefined : `de ${variantes.length} ${variantes.length === 1 ? 'variante' : 'variantes'}`}
          onClick={() => navigate('/inventario')}
        />
        <KpiCard
          label="Ventas del día"
          value={cargando ? '—' : clp(ventasHoy.total)}
          tone="success"
          icon={<Banknote size={16} />}
          delta={cargando ? undefined : `${ventasHoy.cantidad} ${ventasHoy.cantidad === 1 ? 'venta' : 'ventas'}`}
          onClick={() => navigate('/ventas')}
        />
        <KpiCard
          label="Pedidos pendientes"
          value={cargando ? '—' : pedidosPendientes.length}
          tone="warning"
          icon={<Truck size={16} />}
          footnote={cargando ? undefined : `${soloPendientes.length} sin preparar`}
          onClick={() => navigate('/pedidos')}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esEscritorio ? '1.25fr 1fr' : '1fr',
          gap: esEscritorio ? 'var(--space-5)' : 'var(--space-4)',
          alignItems: 'start',
        }}
      >
        {alertasStock}
        {ultimos}
      </div>
    </Shell>
  )
}
