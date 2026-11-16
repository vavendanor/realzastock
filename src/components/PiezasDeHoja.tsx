import { useState } from 'react'
import { useCambiosPendientes } from '../hooks/useCambiosPendientes'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { calcularPlazo, inicioDelPlazo, PLAZO_FABRICACION_DIAS, semaforoDelPlazo, type Calendario, type ColorPlazo } from '../lib/diasHabiles'
import { ETAPAS, etapasBloqueadas, formatearFechaPedido } from '../lib/ordenes'
import { ladoDeLista, medidaDeLista, modeloDeLista, telaDeLista } from '../lib/excelHoja'
import type { GrupoPedido } from '../lib/vistasDeHoja'
import type { Etapa, OrdenFabricacion } from '../types'
import { CasillaEtapa } from './CasillaEtapa'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { EstadoOrdenBadge } from './ui/EstadoOrdenBadge'
import { Input } from './ui/Input'

const mensajeDe = (err: unknown, porDefecto: string) => (err instanceof Error ? err.message : porDefecto)

/* ---------------- Plazo de un pedido ---------------- */

const COLORES_PLAZO: Record<ColorPlazo, { fondo: string; texto: string; barra: string }> = {
  verde: { fondo: 'var(--state-success-soft)', texto: 'var(--state-success)', barra: 'var(--state-success)' },
  amarillo: { fondo: 'var(--state-warning-soft)', texto: 'var(--tinta-700)', barra: 'var(--state-warning)' },
  rojo: { fondo: 'var(--state-danger-soft)', texto: 'var(--state-danger)', barra: 'var(--state-danger)' },
}

/* El plazo de una pieza que sigue por fabricar, en una sola etiqueta de color ("Faltan 9 días", "Atrasado 4 días")
   con una barra que se llena hasta los 14 días hábiles. Las piezas terminadas no llevan plazo. */
function EtiquetaPlazo({ orden, calendario, hoy }: { orden: OrdenFabricacion; calendario: Calendario; hoy: string }) {
  if (orden.estado !== 'por_fabricar') return <span style={{ color: 'var(--text-faint)' }}>—</span>
  const p = calcularPlazo(inicioDelPlazo(orden), hoy, calendario)
  const semaforo = semaforoDelPlazo(p)
  const color = COLORES_PLAZO[semaforo.color]
  const lleno = Math.min(p.transcurridos, PLAZO_FABRICACION_DIAS) / PLAZO_FABRICACION_DIAS
  return (
    <span
      data-plazo={semaforo.color}
      title={`${p.transcurridos} de ${PLAZO_FABRICACION_DIAS} días hábiles`}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, minWidth: 116 }}
    >
      <span
        style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 'var(--radius-pill)',
          background: color.fondo,
          color: color.texto,
          font: 'var(--fw-bold) var(--text-body-sm)/1.3 var(--font-sans)',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}
      >
        {semaforo.texto}
      </span>
      <span aria-hidden style={{ height: 4, borderRadius: 'var(--radius-pill)', background: 'var(--arena-300)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${lleno * 100}%`, background: color.barra }} />
      </span>
    </span>
  )
}

/* ---------------- Tabla de piezas ---------------- */

const celda = { padding: 'var(--space-3)', borderBottom: '1px solid var(--border-hairline)', verticalAlign: 'middle' } as const
const encabezado = {
  padding: 'var(--space-3)',
  background: 'var(--arena-100)',
  borderBottom: '1px solid var(--border-default)',
  font: 'var(--fw-bold) var(--text-eyebrow)/1.2 var(--font-sans)',
  letterSpacing: 'var(--ls-eyebrow)',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
} as const

function TablaPiezas({ piezas, calendario, hoy }: { piezas: OrdenFabricacion[]; calendario: Calendario; hoy: string }) {
  const esEscritorio = useEsEscritorio()
  const cp = useCambiosPendientes()

  /* Mismo guardado diferido que en Pedidos: marcar no guarda, queda pendiente hasta "Guardar". */
  const casilla = (o: OrdenFabricacion, etapa: Etapa, etiqueta: string, grande: boolean) => (
    <CasillaEtapa
      key={etapa}
      etiqueta={etiqueta}
      descripcion={`${etiqueta} del pedido ${o.numero}`}
      marcada={cp.valorEfectivo(o, etapa)}
      deshabilitada={etapasBloqueadas(o)}
      pendiente={cp.esPendiente(o.id, etapa)}
      problema={cp.esProblema(o.id, etapa)}
      onCambiar={(v) => cp.marcar(o, etapa, v)}
      grande={grande}
    />
  )

  /* Las piezas que ya no están por fabricar se ven en gris. */
  const terminada = (o: OrdenFabricacion) => cp.ordenEfectiva(o).estado !== 'por_fabricar'
  const detalle = (o: OrdenFabricacion) =>
    [modeloDeLista(o), medidaDeLista(o.cm).medida, ladoDeLista(o.orientacion)].filter(Boolean).join(' · ')

  if (!esEscritorio) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {piezas.map((o) => (
          <div
            key={o.id}
            data-pieza={o.numero}
            data-terminada={terminada(o) ? 'si' : undefined}
            style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-hairline)', background: terminada(o) ? 'var(--arena-100)' : undefined, opacity: terminada(o) ? 0.6 : 1 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="rh-num" style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                  {o.numero}
                </div>
                <div style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>{detalle(o)}</div>
                <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{telaDeLista(o) || '—'}</div>
              </div>
              <EstadoOrdenBadge estado={cp.ordenEfectiva(o).estado} />
            </div>
            <div style={{ marginTop: 'var(--space-2)' }}>
              <EtiquetaPlazo orden={o} calendario={calendario} hoy={hoy} />
            </div>
            {o.notasProduccion && <div style={{ font: 'var(--type-caption)', color: 'var(--text-body)', marginTop: 'var(--space-2)' }}>{o.notasProduccion}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1.9fr', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              {ETAPAS.map((e) => casilla(o, e.id, e.etiqueta, true))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ minWidth: 'max-content', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...encabezado, textAlign: 'left' }}>N°</th>
            <th style={{ ...encabezado, textAlign: 'left' }}>Mueble</th>
            <th style={{ ...encabezado, textAlign: 'left' }}>Tela</th>
            <th style={{ ...encabezado, textAlign: 'left' }}>Comuna</th>
            <th style={{ ...encabezado, textAlign: 'left' }}>Plazo</th>
            {ETAPAS.map((e) => (
              <th key={e.id} style={{ ...encabezado, textAlign: 'center' }}>
                {e.etiqueta}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {piezas.map((o) => (
            <tr
              key={o.id}
              data-pieza={o.numero}
              data-terminada={terminada(o) ? 'si' : undefined}
              style={{ background: terminada(o) ? 'var(--arena-100)' : 'var(--surface-card)', opacity: terminada(o) ? 0.6 : 1 }}
            >
              <td style={celda}>
                <div className="rh-num" style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                  {o.numero}
                </div>
                <EstadoOrdenBadge estado={cp.ordenEfectiva(o).estado} />
              </td>
              <td style={{ ...celda, whiteSpace: 'normal', minWidth: 170, maxWidth: 260 }}>
                <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{detalle(o)}</div>
                {o.notasProduccion && <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{o.notasProduccion}</div>}
              </td>
              <td style={{ ...celda, whiteSpace: 'normal', minWidth: 120 }}>{telaDeLista(o) || '—'}</td>
              <td style={{ ...celda, whiteSpace: 'normal', minWidth: 110, maxWidth: 150 }}>{o.comuna ?? '—'}</td>
              <td style={celda}>
                <EtiquetaPlazo orden={o} calendario={calendario} hoy={hoy} />
              </td>
              {ETAPAS.map((e) => (
                <td key={e.id} style={{ ...celda, textAlign: 'center' }}>
                  {casilla(o, e.id, e.etiqueta, false)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- Inicio del plazo ---------------- */

interface InicioProps {
  pedido: string
  fechaPedido: string
  plazoDesde: string | null
  hoy: string
  alFijar: (fecha: string | null) => Promise<void>
}

/* "Plazo desde 23-10-2026": el plazo de 14 días hábiles cuenta desde la fecha del pedido, salvo que se
   fije otra a mano (por ejemplo, cuando el cliente pagó después). Vale para todo el pedido. */
function InicioDelPlazo({ pedido, fechaPedido, plazoDesde, hoy, alFijar }: InicioProps) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(plazoDesde ?? fechaPedido)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guardar = async (fecha: string | null) => {
    setGuardando(true)
    setError(null)
    try {
      await alFijar(fecha)
      setEditando(false)
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar el inicio del plazo.'))
    } finally {
      setGuardando(false)
    }
  }

  if (!editando) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
        <span data-inicio-plazo={pedido}>
          Plazo desde {formatearFechaPedido(plazoDesde ?? fechaPedido)}
          {plazoDesde ? ' (fijado a mano)' : ' (fecha del pedido)'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Cambiar el inicio del plazo del pedido ${pedido}`}
          onClick={() => {
            setValor(plazoDesde ?? fechaPedido)
            setEditando(true)
          }}
        >
          Cambiar
        </Button>
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Input
        label={`Inicio del plazo del pedido ${pedido}`}
        type="date"
        size="sm"
        value={valor}
        min={fechaPedido}
        max={hoy}
        onChange={(e) => setValor(e.target.value)}
        error={error ?? undefined}
        wrapperStyle={{ minWidth: 190 }}
      />
      <Button size="sm" disabled={guardando || !valor} onClick={() => void guardar(valor)}>
        {guardando ? 'Guardando...' : 'Guardar fecha'}
      </Button>
      {plazoDesde && (
        <Button size="sm" variant="secondary" disabled={guardando} onClick={() => void guardar(null)}>
          Usar la fecha del pedido
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={guardando} onClick={() => setEditando(false)}>
        Cancelar
      </Button>
    </span>
  )
}

/* ---------------- La lista de pedidos ---------------- */

interface ComunesProps {
  calendario: Calendario
  hoy: string
}

export function ListaDePedidos({
  grupos,
  calendario,
  hoy,
  alQuitar,
  alFijarInicio,
}: ComunesProps & { grupos: GrupoPedido[]; alQuitar: (pedido: string) => Promise<void>; alFijarInicio: (pedido: string, fecha: string | null) => Promise<void> }) {
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null)
  const visibles = grupos.filter((g) => !g.cancelado)
  if (visibles.length === 0) return <Card>La hoja no tiene pedidos con piezas por mostrar.</Card>

  return (
    <>
      {errorQuitar && (
        <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
          {errorQuitar}
        </span>
      )}
      {visibles.map((g) => (
        <Card
          key={g.pedido}
          padding="0"
          aria-label={`Pedido ${g.pedido}`}
          title={`Pedido ${g.pedido}`}
          subtitle={
            g.fechaPedido && (
              <InicioDelPlazo pedido={g.pedido} fechaPedido={g.fechaPedido} plazoDesde={g.plazoDesde} hoy={hoy} alFijar={(f) => alFijarInicio(g.pedido, f)} />
            )
          }
          actions={
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Quitar el pedido ${g.pedido} de la hoja`}
              onClick={() => {
                setErrorQuitar(null)
                alQuitar(g.pedido).catch((err) => setErrorQuitar(mensajeDe(err, 'No se pudo quitar el pedido.')))
              }}
            >
              Quitar de la hoja
            </Button>
          }
        >
          <TablaPiezas piezas={g.piezas} calendario={calendario} hoy={hoy} />
        </Card>
      ))}
    </>
  )
}
