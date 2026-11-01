import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { clp, formatearTelefono } from '../lib/format'
import { ESTADO_LABEL, listarPedidos, ORDEN_ESTADOS } from '../lib/pedidos'
import type { EstadoPedido, Pedido } from '../types'
import { Card } from './ui/Card'
import { DataTable, type Column } from './ui/DataTable'
import { EstadoBadge } from './ui/EstadoBadge'
import { Select } from './ui/Select'

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-CL')
}

interface Props {
  /* Cada vez que cambia, la lista vuelve a pedir sus datos (botón "Recargar"). */
  recargaToken: number
}

/* Pedidos creados a mano en esta app (flujo anterior a las órdenes de
   fabricación de Shopify). Es la pantalla de Pedidos de antes, sin cambios de
   lógica: solo se movió a un componente para poder ponerle pestañas. */
export function PedidosManuales({ recargaToken }: Props) {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()
  const { rol } = useAuth()

  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<EstadoPedido | 'todos'>('todos')

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setPedidos(await listarPedidos({ estado: filtroEstado }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar los pedidos')
    } finally {
      setCargando(false)
    }
  }, [filtroEstado])

  useEffect(() => {
    void cargar()
  }, [cargar, recargaToken])

  /* Conteo por estado sobre el total sin filtrar: si se calculara sobre
     `pedidos` (ya filtrado), las tarjetas de resumen colapsarían a un solo
     número apenas se aplicara un filtro. */
  const [todos, setTodos] = useState<Pedido[]>([])
  useEffect(() => {
    listarPedidos().then(setTodos).catch(() => {})
  }, [recargaToken])

  const conteos = useMemo(() => {
    const mapa = new Map<EstadoPedido, number>()
    for (const estado of ORDEN_ESTADOS) mapa.set(estado, 0)
    for (const pedido of todos) mapa.set(pedido.estado, (mapa.get(pedido.estado) ?? 0) + 1)
    return mapa
  }, [todos])

  const columnas: Column<Pedido>[] = [
    {
      key: 'cliente',
      header: 'Cliente',
      render: (r) => (
        <div>
          <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{r.clienteNombre}</div>
          {r.clienteContacto && (
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{formatearTelefono(r.clienteContacto)}</div>
          )}
        </div>
      ),
    },
    { key: 'fecha', header: 'Fecha', render: (r) => <span>{formatearFecha(r.fechaCreacion)}</span> },
    {
      key: 'productos',
      header: 'Productos',
      render: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {r.items.map((item, i) => (
            <div key={i} style={{ font: 'var(--type-caption)', color: 'var(--text-body)' }}>
              {item.cantidad} × {item.modelo} <span style={{ color: 'var(--text-muted)' }}>· {item.color}</span>
            </div>
          ))}
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
    { key: 'estado', header: 'Estado', render: (r) => <EstadoBadge estado={r.estado} /> },
  ]

  const filtro = (
    <Select
      size="sm"
      value={filtroEstado}
      onChange={(e) => setFiltroEstado(e.target.value as EstadoPedido | 'todos')}
      options={[{ value: 'todos', label: 'Todos los estados' }, ...ORDEN_ESTADOS.map((e) => ({ value: e, label: ESTADO_LABEL[e] }))]}
      wrapperStyle={{ width: 200 }}
    />
  )

  return (
    <>
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      {rol === 'vendedor' && (
        <Card padding="var(--space-3) var(--space-5)" tone="sunken">
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            Estás viendo solo los pedidos que tú creaste.
          </span>
        </Card>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esEscritorio ? `repeat(${ORDEN_ESTADOS.length},1fr)` : 'repeat(2,1fr)',
          gap: 'var(--space-3)',
        }}
      >
        {ORDEN_ESTADOS.map((estado) => (
          <Card key={estado}>
            <EstadoBadge estado={estado} />
            <div
              className="rh-num"
              style={{ font: 'var(--fw-medium) 30px/1 var(--font-display)', color: 'var(--text-strong)', marginTop: 'var(--space-3)' }}
            >
              {conteos.get(estado) ?? 0}
            </div>
          </Card>
        ))}
      </div>

      {esEscritorio ? (
        <Card padding="0" title="Listado" subtitle={cargando ? 'Cargando...' : `${pedidos.length} pedidos`} actions={filtro}>
          <DataTable
            rows={pedidos}
            columns={columnas}
            onRowClick={(r) => navigate(`/pedidos/${r.id}`)}
            emptyLabel={cargando ? 'Cargando pedidos...' : 'Sin pedidos en este estado'}
          />
        </Card>
      ) : (
        <>
          <Card title="Filtro">{filtro}</Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {cargando && (
              <Card>
                <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando pedidos...</span>
              </Card>
            )}
            {!cargando && pedidos.length === 0 && (
              <Card>
                <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Sin pedidos en este estado.</span>
              </Card>
            )}
            {pedidos.map((pedido) => (
              <Card key={pedido.id} padding="var(--space-4)" onClick={() => navigate(`/pedidos/${pedido.id}`)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                  <span style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{pedido.clienteNombre}</span>
                  <EstadoBadge estado={pedido.estado} />
                </div>
                {pedido.items.map((item, i) => (
                  <div key={i} style={{ font: 'var(--type-caption)', color: 'var(--text-body)' }}>
                    {item.cantidad} × {item.modelo} <span style={{ color: 'var(--text-muted)' }}>· {item.color}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-2)' }}>
                  <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{formatearFecha(pedido.fechaCreacion)}</span>
                  <span className="rh-num" style={{ font: 'var(--type-numeric)', color: 'var(--text-strong)' }}>
                    {clp(pedido.total)}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}
