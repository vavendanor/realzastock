import { CirclePlus, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DataTable, type Column } from '../components/ui/DataTable'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { clp, haceDias, hoy } from '../lib/format'
import { CANALES, etiquetaCanal, listarVentas } from '../lib/ventas'
import type { CanalVenta, Venta } from '../types'

function formatearFecha(iso: string) {
  const fecha = new Date(iso)
  return {
    dia: fecha.toLocaleDateString('es-CL'),
    hora: fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
  }
}

function Kpi({ label, value, footnote }: { label: string; value: string; footnote: string }) {
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span className="rh-eyebrow">{label}</span>
        <span
          className="rh-num"
          style={{ font: 'var(--fw-medium) 28px/1.1 var(--font-display)', color: 'var(--text-strong)' }}
        >
          {value}
        </span>
        <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{footnote}</span>
      </div>
    </Card>
  )
}

export function Ventas() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()
  const { rol } = useAuth()

  const [ventas, setVentas] = useState<Venta[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(hoy())
  const [canal, setCanal] = useState<CanalVenta | 'todos'>('todos')

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setVentas(await listarVentas({ desde, hasta, canal }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar las ventas')
    } finally {
      setCargando(false)
    }
  }, [desde, hasta, canal])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const total = ventas.reduce((suma, venta) => suma + venta.total, 0)
  const unidades = ventas.reduce((suma, venta) => suma + venta.unidades, 0)
  const ticket = ventas.length > 0 ? Math.round(total / ventas.length) : 0

  const columnas: Column<Venta>[] = [
    {
      key: 'fecha',
      header: 'Fecha',
      render: (r) => {
        const { dia, hora } = formatearFecha(r.fecha)
        return (
          <div>
            <div>{dia}</div>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{hora}</div>
          </div>
        )
      },
    },
    { key: 'vendedor', header: 'Vendedor', render: (r) => <span>{r.vendedorNombre}</span> },
    {
      key: 'canal',
      header: 'Canal',
      render: (r) => (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 10px',
            borderRadius: 'var(--radius-pill)',
            font: 'var(--type-caption)',
            background: r.canal === 'showroom' ? 'var(--surface-accent-soft)' : 'var(--state-info-soft)',
            color: r.canal === 'showroom' ? 'var(--cobre-700)' : 'var(--state-info)',
          }}
        >
          {etiquetaCanal(r.canal)}
        </span>
      ),
    },
    {
      key: 'productos',
      header: 'Productos vendidos',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {r.items.map((item, i) => (
            <div key={i}>
              <span style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                {item.cantidad} × {item.modelo}
              </span>
              <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                {' '}
                · {item.color} · {item.sku}
              </span>
            </div>
          ))}
          {r.items.length === 0 && <span style={{ color: 'var(--text-faint)' }}>Sin líneas</span>}
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (r) => (
        <span className="rh-num" style={{ font: 'var(--type-numeric)', color: 'var(--text-strong)' }}>
          {clp(r.total)}
        </span>
      ),
    },
  ]

  const filtros = (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-end',
        flexWrap: 'wrap',
      }}
    >
      <Input
        size="sm"
        label="Desde"
        type="date"
        value={desde}
        onChange={(e) => setDesde(e.target.value)}
        wrapperStyle={{ width: 150 }}
      />
      <Input
        size="sm"
        label="Hasta"
        type="date"
        value={hasta}
        onChange={(e) => setHasta(e.target.value)}
        wrapperStyle={{ width: 150 }}
      />
      <Select
        size="sm"
        label="Canal"
        value={canal}
        onChange={(e) => setCanal(e.target.value as CanalVenta | 'todos')}
        options={[{ value: 'todos', label: 'Todos los canales' }, ...CANALES]}
        wrapperStyle={{ width: 180 }}
      />
    </div>
  )

  return (
    <Shell
      eyebrow="COMERCIAL"
      title="Ventas"
      actions={
        <>
          <IconButton label="Recargar" variant="outline" onClick={() => void cargar()}>
            <RotateCw size={15} />
          </IconButton>
          <Button variant="accent" iconLeft={<CirclePlus size={16} />} onClick={() => navigate('/ventas/nueva')}>
            {esEscritorio ? 'Registrar venta' : 'Vender'}
          </Button>
        </>
      }
    >
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            No se pudieron cargar las ventas: {error}
          </span>
        </Card>
      )}

      {rol === 'vendedor' && (
        <Card padding="var(--space-3) var(--space-5)" tone="sunken">
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            Estás viendo solo tus propias ventas.
          </span>
        </Card>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esEscritorio ? 'repeat(3,1fr)' : '1fr',
          gap: esEscritorio ? 'var(--space-5)' : 'var(--space-3)',
        }}
      >
        <Kpi label="Total del período" value={clp(total)} footnote={`${desde} al ${hasta}`} />
        <Kpi label="Ventas registradas" value={String(ventas.length)} footnote={`${unidades} unidades`} />
        <Kpi label="Ticket promedio" value={clp(ticket)} footnote="por venta" />
      </div>

      {esEscritorio ? (
        <Card padding="0" title="Historial" subtitle={cargando ? 'Cargando...' : `${ventas.length} ventas`} actions={filtros}>
          <DataTable
            rows={ventas}
            columns={columnas}
            emptyLabel={cargando ? 'Cargando ventas...' : 'Sin ventas en el período seleccionado'}
          />
        </Card>
      ) : (
        <>
          <Card title="Filtros">{filtros}</Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {cargando && (
              <Card>
                <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando ventas...</span>
              </Card>
            )}
            {!cargando && ventas.length === 0 && (
              <Card>
                <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>
                  Sin ventas en el período seleccionado.
                </span>
              </Card>
            )}
            {ventas.map((venta) => {
              const { dia, hora } = formatearFecha(venta.fecha)
              return (
                <Card key={venta.id} padding="var(--space-4)">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                        {dia} · {hora} · {etiquetaCanal(venta.canal)}
                      </div>
                      {venta.items.map((item, i) => (
                        <div key={i} style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                          {item.cantidad} × {item.modelo}
                          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}> · {item.color}</span>
                        </div>
                      ))}
                      <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{venta.vendedorNombre}</div>
                    </div>
                    <span
                      className="rh-num"
                      style={{ font: 'var(--type-numeric)', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}
                    >
                      {clp(venta.total)}
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </Shell>
  )
}
