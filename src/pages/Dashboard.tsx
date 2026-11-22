import { Banknote, Clock, Factory, Layers, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExportarPedidos } from '../components/ExportarPedidos'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EstadoOrdenBadge } from '../components/ui/EstadoOrdenBadge'
import { KpiCard } from '../components/ui/KpiCard'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { listarPiezasAtrasadas, type PiezaAtrasada } from '../lib/atrasados'
import { hoyEnChile } from '../lib/diasHabiles'
import { clp, hoy } from '../lib/format'
import { MODULOS_COMERCIALES_ACTIVOS } from '../lib/modulos'
import { contarOrdenesPorEstado, formatearFechaPedido, listarUltimasOrdenes, type ConteoEstados } from '../lib/ordenes'
import { formatearMetros, listarTelas, telasEnAlerta, type Tela } from '../lib/telas'
import { listarVentas } from '../lib/ventas'
import type { OrdenFabricacion } from '../types'

/* Pantalla de inicio del administrador. Es solo lectura: las cifras y
   listas de acá son un resumen para decidir qué revisar, no un punto de
   edición — para eso están Inventario y Pedidos, un clic más allá. */
export function Dashboard() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()

  const [telas, setTelas] = useState<Tela[]>([])
  const [atrasadas, setAtrasadas] = useState<{ piezas: PiezaAtrasada[]; sinCalendario: boolean }>({ piezas: [], sinCalendario: false })
  const [ventasHoy, setVentasHoy] = useState<{ total: number; cantidad: number }>({ total: 0, cantidad: 0 })
  const [conteoOrdenes, setConteoOrdenes] = useState<ConteoEstados | null>(null)
  const [ultimasOrdenes, setUltimasOrdenes] = useState<OrdenFabricacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cargar = async () => {
      setCargando(true)
      setError(null)
      try {
        const fechaHoy = hoy()
        const [datosTelas, datosAtrasadas, datosVentasHoy, datosConteo, datosUltimas] = await Promise.all([
          listarTelas(),
          listarPiezasAtrasadas(hoyEnChile()),
          MODULOS_COMERCIALES_ACTIVOS ? listarVentas({ desde: fechaHoy, hasta: fechaHoy }) : Promise.resolve([]),
          contarOrdenesPorEstado(false),
          listarUltimasOrdenes(5),
        ])
        setTelas(datosTelas)
        setAtrasadas(datosAtrasadas)
        setVentasHoy({
          cantidad: datosVentasHoy.length,
          total: datosVentasHoy.reduce((suma, venta) => suma + venta.total, 0),
        })
        setConteoOrdenes(datosConteo)
        setUltimasOrdenes(datosUltimas)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el dashboard')
      } finally {
        setCargando(false)
      }
    }
    void cargar()
  }, [])

  const telasBajas = telasEnAlerta(telas)
  const porFabricar = conteoOrdenes?.por_fabricar ?? 0
  const listosParaDespachar = conteoOrdenes?.fabricado ?? 0
  const columnasKpi = 3 + (MODULOS_COMERCIALES_ACTIVOS ? 1 : 0)

  const alertaAtrasados = (
    <Card
      title="Pedidos atrasados"
      subtitle={cargando ? 'Cargando...' : `${atrasadas.piezas.length} ${atrasadas.piezas.length === 1 ? 'pieza pasada' : 'piezas pasadas'} del plazo de 14 días hábiles`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate('/pedidos')}>
          Ver pedidos
        </Button>
      }
    >
      <div data-alerta-atrasados style={{ display: 'flex', flexDirection: 'column' }}>
        {atrasadas.sinCalendario && (
          <span data-sin-calendario style={{ font: 'var(--type-caption)', color: 'var(--state-danger)', paddingBottom: 'var(--space-2)' }}>
            Faltan feriados por cargar en alguno de esos años: los días de atraso pueden estar mal.
          </span>
        )}
        {!cargando && atrasadas.piezas.length === 0 && (
          <span data-sin-atrasados style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>
            No hay piezas atrasadas: todo lo que se está fabricando va dentro del plazo.
          </span>
        )}
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {atrasadas.piezas.map((pieza, i) => (
            <div
              key={pieza.id}
              data-pieza-atrasada={pieza.numero}
              onClick={() => navigate(`/pedidos/${pieza.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderTop: i ? '1px solid var(--border-hairline)' : 'none', cursor: 'pointer' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pieza.numero} · {pieza.modelo}
                </div>
                <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{pieza.comuna}</div>
              </div>
              <span
                data-dias-atraso={pieza.dias}
                style={{ padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--state-danger-soft)', color: 'var(--state-danger)', font: 'var(--fw-bold) var(--text-body-sm)/1.3 var(--font-sans)', whiteSpace: 'nowrap' }}
              >
                Atrasado {pieza.dias} {pieza.dias === 1 ? 'día' : 'días'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )

  const alertaTelas = (
    <Card
      title="Alertas de stock de telas"
      subtitle="Telas en o bajo su mínimo"
      actions={
        <Button size="sm" variant="secondary" onClick={() => navigate('/inventario')}>
          Ver inventario
        </Button>
      }
    >
      <div data-alerta-telas style={{ display: 'flex', flexDirection: 'column' }}>
        {!cargando && telasBajas.length === 0 && (
          <span data-sin-telas-bajas style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>
            Ninguna tela está en su mínimo: el stock está sobre lo necesario.
          </span>
        )}
        {telasBajas.map((tela, i) => (
          <div
            key={tela.id}
            data-tela-baja={tela.nombre}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderTop: i ? '1px solid var(--border-hairline)' : 'none' }}
          >
            <TriangleAlert size={16} color="var(--state-danger)" />
            <div style={{ flex: 1, minWidth: 0, font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{tela.nombre}</div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ font: 'var(--type-numeric)', color: 'var(--state-danger)' }}>{formatearMetros(tela.metros)}</div>
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-faint)' }}>mínimo {formatearMetros(tela.stockMinimo)}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )

  const ultimos = (
    <Card
      title="Últimas órdenes"
      subtitle="Los 5 muebles más recientes"
      actions={
        <Button size="sm" variant="ghost" onClick={() => navigate('/pedidos')}>
          Ver todas
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {!cargando && ultimasOrdenes.length === 0 && (
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Todavía no hay órdenes de fabricación.</span>
        )}
        {ultimasOrdenes.map((orden, i) => (
          <div
            key={orden.id}
            onClick={() => navigate(`/pedidos/${orden.id}`)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) 0',
              borderTop: i ? '1px solid var(--border-hairline)' : 'none',
              cursor: 'pointer',
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
                {orden.numero} · {orden.modelo ?? '—'}
              </div>
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                {[orden.tipo, orden.comuna].filter(Boolean).join(' · ') || '—'} · {formatearFechaPedido(orden.fechaPedido)}
              </div>
            </div>
            <EstadoOrdenBadge estado={orden.estado} />
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
          gridTemplateColumns: esEscritorio ? `repeat(${columnasKpi},1fr)` : '1fr',
          gap: esEscritorio ? 'var(--space-5)' : 'var(--space-3)',
        }}
      >
        <KpiCard
          label="Piezas atrasadas"
          value={cargando ? '—' : atrasadas.piezas.length}
          tone={atrasadas.piezas.length > 0 ? 'danger' : 'success'}
          icon={<Clock size={16} />}
          footnote={cargando ? undefined : 'pasadas de los 14 días hábiles'}
          onClick={() => navigate('/pedidos')}
        />
        <KpiCard
          label="Telas con stock bajo"
          value={cargando ? '—' : telasBajas.length}
          tone={telasBajas.length > 0 ? 'danger' : 'success'}
          icon={<Layers size={16} />}
          footnote={cargando ? undefined : `de ${telas.length} ${telas.length === 1 ? 'tela' : 'telas'}`}
          onClick={() => navigate('/inventario')}
        />
        {MODULOS_COMERCIALES_ACTIVOS && (
          <KpiCard
            label="Ventas del día"
            value={cargando ? '—' : clp(ventasHoy.total)}
            tone="success"
            icon={<Banknote size={16} />}
            delta={cargando ? undefined : `${ventasHoy.cantidad} ${ventasHoy.cantidad === 1 ? 'venta' : 'ventas'}`}
            onClick={() => navigate('/ventas')}
          />
        )}
        <KpiCard
          label="Muebles por fabricar"
          value={cargando ? '—' : porFabricar}
          tone="warning"
          icon={<Factory size={16} />}
          footnote={cargando ? undefined : `${listosParaDespachar} listos para despachar`}
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
        {alertaAtrasados}
        <div style={{ display: 'flex', flexDirection: 'column', gap: esEscritorio ? 'var(--space-5)' : 'var(--space-4)' }}>
          {alertaTelas}
          {ultimos}
        </div>
      </div>

      <ExportarPedidos />
    </Shell>
  )
}
