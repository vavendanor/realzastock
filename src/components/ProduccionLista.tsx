import { Factory, FileDown, FilterX, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { exportarPedidosAExcel } from '../lib/exportarPedidos'
import {
  aplicarEtapaLocal,
  contarOrdenesPorEstado,
  contarOrdenesTotales,
  ESTADO_ORDEN_LABEL,
  etapaMarcada,
  etapasBloqueadas,
  ETAPAS,
  fechaLocal,
  FILTROS_ORDENES_VACIOS,
  filtrosActivos,
  formatearFechaPedido,
  LIMITE_ORDENES,
  listarOpcionesFiltro,
  listarOrdenes,
  marcarEtapa,
  ORDEN_ESTADOS_ORDEN,
  ORDEN_ORIGENES,
  ORIGEN_LABEL,
  type ConteoEstados,
  type FiltrosOrdenes,
  type OpcionesFiltro,
} from '../lib/ordenes'
import { faltaColorTela, mencionaPatas, preparadoPorShopify, shopifyDesmarco } from '../lib/avisosOrden'
import type { Etapa, OrdenFabricacion } from '../types'
import { CasillaEtapa } from './CasillaEtapa'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Checkbox } from './ui/Checkbox'
import { DataTable, type Column } from './ui/DataTable'
import { EstadoOrdenBadge } from './ui/EstadoOrdenBadge'
import { Input } from './ui/Input'
import { Select } from './ui/Select'

interface Props {
  /* Cada vez que cambia, la pestaña vuelve a pedir sus datos. */
  recargaToken: number
}

type Atajo = { id: string; etiqueta: string; rango: () => [string, string] }

/* Rangos de fecha con la fecha del dispositivo. Son botones opcionales: por
   defecto no hay ningún filtro de fecha. */
const ATAJOS: Atajo[] = [
  {
    id: 'hoy',
    etiqueta: 'Hoy',
    rango: () => {
      const h = fechaLocal(new Date())
      return [h, h]
    },
  },
  {
    id: '7dias',
    etiqueta: 'Últimos 7 días',
    rango: () => {
      const fin = new Date()
      const ini = new Date()
      ini.setDate(ini.getDate() - 6)
      return [fechaLocal(ini), fechaLocal(fin)]
    },
  },
  {
    id: 'mes',
    etiqueta: 'Este mes',
    rango: () => {
      const ahora = new Date()
      return [fechaLocal(new Date(ahora.getFullYear(), ahora.getMonth(), 1)), fechaLocal(new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0))]
    },
  },
]

const mensajeError = (err: unknown, porDefecto: string) => (err instanceof Error ? err.message : porDefecto)

const subtitulo = (o: OrdenFabricacion) =>
  [
    o.tipo,
    o.orientacion && o.orientacion !== 'ninguna' ? `orientación ${o.orientacion}` : null,
    o.patas && o.patas !== 'PREDETERMINADAS' ? `patas ${o.patas.toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

const chip = (texto: string, tono: 'aviso' | 'neutro') => (
  <span
    style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      font: 'var(--fw-bold) var(--text-body-xs)/1.3 var(--font-sans)',
      background: tono === 'aviso' ? 'var(--state-warning-soft)' : 'var(--arena-300)',
      color: tono === 'aviso' ? 'var(--tinta-700)' : 'var(--text-muted)',
      whiteSpace: 'nowrap',
    }}
  >
    {texto}
  </span>
)

export function ProduccionLista({ recargaToken }: Props) {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()

  const [filtros, setFiltros] = useState<FiltrosOrdenes>(FILTROS_ORDENES_VACIOS)
  const [ordenes, setOrdenes] = useState<OrdenFabricacion[]>([])
  const [limitado, setLimitado] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorEtapa, setErrorEtapa] = useState<string | null>(null)
  const [conteos, setConteos] = useState<ConteoEstados | null>(null)
  /* null = todavía no se sabe. 0 = no se ha importado ninguna orden. */
  const [totalSistema, setTotalSistema] = useState<number | null>(null)
  const [opciones, setOpciones] = useState<OpcionesFiltro>({ comunas: [], modelos: [], telas: [] })
  const [pendientes, setPendientes] = useState<ReadonlySet<string>>(new Set())
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [avisoExportacion, setAvisoExportacion] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const esAdministrador = useAuth().rol === 'administrador'
  /* Para ignorar respuestas viejas si el usuario cambia filtros rápido. */
  const peticion = useRef(0)

  const fechasInvertidas = Boolean(filtros.desde && filtros.hasta && filtros.desde > filtros.hasta)
  const cambiarFiltros = (parcial: Partial<FiltrosOrdenes>) => setFiltros((f) => ({ ...f, ...parcial }))
  const nFiltros = filtrosActivos(filtros)

  const cargarLista = useCallback(async () => {
    const numero = ++peticion.current
    if (fechasInvertidas) {
      setOrdenes([])
      setLimitado(false)
      setCargando(false)
      return
    }
    setCargando(true)
    setError(null)
    try {
      const resultado = await listarOrdenes(filtros)
      if (numero !== peticion.current) return
      setOrdenes(resultado.ordenes)
      setLimitado(resultado.limitado)
    } catch (err) {
      if (numero === peticion.current) setError(mensajeError(err, 'Error desconocido al cargar las órdenes'))
    } finally {
      if (numero === peticion.current) setCargando(false)
    }
  }, [filtros, fechasInvertidas])

  const incluirAdicionales = filtros.incluirAdicionales
  const cargarResumen = useCallback(async () => {
    try {
      const [porEstado, total, valores] = await Promise.all([
        contarOrdenesPorEstado(incluirAdicionales),
        contarOrdenesTotales(),
        listarOpcionesFiltro(incluirAdicionales),
      ])
      setConteos(porEstado)
      setTotalSistema(total)
      setOpciones(valores)
    } catch (err) {
      setError(mensajeError(err, 'Error desconocido al cargar el resumen'))
    }
  }, [incluirAdicionales])

  useEffect(() => {
    void cargarLista()
  }, [cargarLista, recargaToken])

  useEffect(() => {
    void cargarResumen()
  }, [cargarResumen, recargaToken])

  const cambiarEtapa = async (orden: OrdenFabricacion, etapa: Etapa, valor: boolean) => {
    if (etapa === 'listo' && !valor && !window.confirm(`¿Quitar LISTO de ${orden.numero}? Volverá a "Por fabricar".`)) return

    setErrorEtapa(null)
    setPendientes((p) => new Set(p).add(orden.id))
    /* Se muestra el cambio al instante; si el servidor lo rechaza, se revierte. */
    setOrdenes((filas) => filas.map((o) => (o.id === orden.id ? aplicarEtapaLocal(o, etapa, valor) : o)))
    try {
      const actualizada = await marcarEtapa(orden.id, etapa, valor)
      setOrdenes((filas) => filas.map((o) => (o.id === orden.id ? actualizada : o)))
      if (etapa === 'listo') void cargarResumen()
    } catch (err) {
      setOrdenes((filas) => filas.map((o) => (o.id === orden.id ? orden : o)))
      setErrorEtapa(`No se pudo actualizar ${orden.numero}: ${mensajeError(err, 'error desconocido')}`)
    } finally {
      setPendientes((p) => {
        const resto = new Set(p)
        resto.delete(orden.id)
        return resto
      })
    }
  }

  const abrir = (o: OrdenFabricacion) => navigate(`/pedidos/${o.id}`)

  const casilla = (o: OrdenFabricacion, etapa: Etapa, etiqueta: string, grande: boolean) => (
    <CasillaEtapa
      key={etapa}
      etiqueta={etiqueta}
      descripcion={`${etiqueta} del pedido ${o.numero}`}
      marcada={etapaMarcada(o, etapa)}
      deshabilitada={etapasBloqueadas(o) || pendientes.has(o.id)}
      onCambiar={(v) => void cambiarEtapa(o, etapa, v)}
      grande={grande}
    />
  )

  /* ---------------- Resumen por estado ---------------- */
  const resumen = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: esEscritorio ? `repeat(${ORDEN_ESTADOS_ORDEN.length},1fr)` : 'repeat(2,1fr)',
        gap: 'var(--space-3)',
      }}
    >
      {ORDEN_ESTADOS_ORDEN.map((estado) => {
        const activo = filtros.estado === estado
        return (
          <Card
            key={estado}
            role="button"
            tabIndex={0}
            aria-pressed={activo}
            aria-label={`${ESTADO_ORDEN_LABEL[estado]}: ${conteos?.[estado] ?? 0}. Filtrar por este estado`}
            onClick={() => cambiarFiltros({ estado: activo ? 'todos' : estado })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                cambiarFiltros({ estado: activo ? 'todos' : estado })
              }
            }}
            style={{ cursor: 'pointer', outline: activo ? '2px solid var(--action-accent)' : 'none', outlineOffset: -2 }}
          >
            <EstadoOrdenBadge estado={estado} />
            <div
              className="rh-num"
              style={{ font: 'var(--fw-medium) 30px/1 var(--font-display)', color: 'var(--text-strong)', marginTop: 'var(--space-3)' }}
            >
              {conteos ? conteos[estado] : '–'}
            </div>
          </Card>
        )
      })}
    </div>
  )

  /* ---------------- Filtros ---------------- */
  const atajoActivo = (a: Atajo) => {
    const [d, h] = a.rango()
    return filtros.desde === d && filtros.hasta === h
  }
  const tamano = esEscritorio ? 'md' : 'touch'

  const camposFiltro = (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esEscritorio ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--space-3)',
        }}
      >
        <Input label="Desde" type="date" size={tamano} value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => cambiarFiltros({ desde: e.target.value })} />
        <Input label="Hasta" type="date" size={tamano} value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => cambiarFiltros({ hasta: e.target.value })} />
        <Select
          label="Estado"
          size={tamano}
          value={filtros.estado}
          onChange={(e) => cambiarFiltros({ estado: e.target.value as FiltrosOrdenes['estado'] })}
          options={[{ value: 'todos', label: 'Todos' }, ...ORDEN_ESTADOS_ORDEN.map((e) => ({ value: e, label: ESTADO_ORDEN_LABEL[e] }))]}
        />
        <Select
          label="Origen"
          size={tamano}
          value={filtros.origen}
          onChange={(e) => cambiarFiltros({ origen: e.target.value as FiltrosOrdenes['origen'] })}
          options={[{ value: 'todos', label: 'Todos' }, ...ORDEN_ORIGENES.map((o) => ({ value: o, label: ORIGEN_LABEL[o] }))]}
        />
        <Select
          label="Comuna"
          size={tamano}
          value={filtros.comuna}
          onChange={(e) => cambiarFiltros({ comuna: e.target.value })}
          options={[{ value: '', label: 'Todas' }, ...opciones.comunas]}
        />
        <Select
          label="Modelo"
          size={tamano}
          value={filtros.modelo}
          onChange={(e) => cambiarFiltros({ modelo: e.target.value })}
          options={[{ value: '', label: 'Todos' }, ...opciones.modelos]}
        />
        <Select
          label="Tela"
          size={tamano}
          value={filtros.tela}
          onChange={(e) => cambiarFiltros({ tela: e.target.value })}
          options={[{ value: '', label: 'Todas' }, ...opciones.telas]}
        />
      </div>

      {fechasInvertidas && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--state-danger)', marginTop: 'var(--space-3)' }}>
          La fecha "Desde" es posterior a "Hasta": no hay nada que mostrar.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
        {ATAJOS.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={atajoActivo(a) ? 'primary' : 'secondary'}
            onClick={() => {
              const [desde, hasta] = a.rango()
              cambiarFiltros({ desde, hasta })
            }}
          >
            {a.etiqueta}
          </Button>
        ))}
        <Checkbox
          label="Mostrar adicionales (patas, cojines…)"
          checked={filtros.incluirAdicionales}
          onChange={(e) => cambiarFiltros({ incluirAdicionales: e.target.checked })}
        />
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<FilterX size={15} />}
          disabled={nFiltros === 0}
          onClick={() => cambiarFiltros({ ...FILTROS_ORDENES_VACIOS, incluirAdicionales: filtros.incluirAdicionales })}
        >
          Limpiar filtros
        </Button>
      </div>
    </>
  )

  /* Exportar a Excel: solo para el administrador. Exporta lo que coincide con los
     filtros puestos (no solo las 500 filas de la lista). Es una restricción de
     la pantalla, no de la base de datos. */
  const exportar = async () => {
    setExportando(true)
    setAvisoExportacion(null)
    try {
      const r = await exportarPedidosAExcel(filtros)
      setAvisoExportacion({ tipo: 'ok', texto: `Se descargó ${r.archivo} con ${r.filas} ${r.filas === 1 ? 'fila' : 'filas'}.` })
    } catch (err) {
      setAvisoExportacion({ tipo: 'error', texto: mensajeError(err, 'No se pudo generar el archivo.') })
    } finally {
      setExportando(false)
    }
  }
  const cuantasFilas = limitado ? `${LIMITE_ORDENES}+` : String(ordenes.length)
  const botonExportar = esAdministrador ? (
    <Button
      size={esEscritorio ? 'sm' : 'md'}
      variant="secondary"
      fullWidth={!esEscritorio}
      iconLeft={<FileDown size={15} />}
      disabled={cargando || exportando || fechasInvertidas || ordenes.length === 0}
      onClick={() => void exportar()}
    >
      {exportando ? 'Generando Excel...' : `Exportar a Excel (${cuantasFilas})`}
    </Button>
  ) : null

  const tarjetaFiltros = esEscritorio ? (
    <Card title="Filtros" actions={botonExportar}>
      {camposFiltro}
    </Card>
  ) : (
    <Card padding="var(--space-4)">
      <Button
        variant="secondary"
        fullWidth
        iconLeft={<SlidersHorizontal size={16} />}
        aria-expanded={filtrosAbiertos}
        onClick={() => setFiltrosAbiertos((a) => !a)}
      >
        {nFiltros ? `Filtros (${nFiltros} activos)` : 'Filtros'}
      </Button>
      {filtrosAbiertos && <div style={{ marginTop: 'var(--space-4)' }}>{camposFiltro}</div>}
      {botonExportar && <div style={{ marginTop: 'var(--space-3)' }}>{botonExportar}</div>}
    </Card>
  )

  /* ---------------- Tabla (escritorio) ---------------- */
  const columnas: Column<OrdenFabricacion>[] = [
    {
      key: 'numero',
      header: 'N° y estado',
      render: (o) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
          <span className="rh-num" style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
            {o.numero}
          </span>
          <EstadoOrdenBadge estado={o.estado} />
          {preparadoPorShopify(o) && chip('Preparado en Shopify', 'neutro')}
          {shopifyDesmarco(o) && chip('Shopify ya no lo tiene preparado', 'aviso')}
          {o.origen === 'manual_shopify' && chip('Manual', 'neutro')}
          {o.esAdicional && chip('Adicional', 'neutro')}
        </div>
      ),
    },
    {
      key: 'mueble',
      header: 'Mueble',
      render: (o) => (
        <div style={{ whiteSpace: 'normal', minWidth: 140, maxWidth: 190 }}>
          <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{o.modelo ?? '—'}</div>
          {subtitulo(o) && <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{subtitulo(o)}</div>}
          {mencionaPatas(o) && <div style={{ marginTop: 4 }}>{chip('Patas en la nota', 'aviso')}</div>}
          {o.notasProduccion && (
            <div
              title={o.notasProduccion}
              style={{
                marginTop: 4,
                font: 'var(--type-caption)',
                color: 'var(--text-body)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {o.notasProduccion}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'medidas',
      header: 'Medida y tela',
      render: (o) => (
        <div style={{ whiteSpace: 'normal', minWidth: 100, maxWidth: 130 }}>
          <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{o.cm ?? '—'}</div>
          <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            {[o.color, o.tela].filter(Boolean).join(' · ') || '—'}
          </div>
          {faltaColorTela(o) && <div style={{ marginTop: 4 }}>{chip(`Falta ${faltaColorTela(o)}`, 'aviso')}</div>}
        </div>
      ),
    },
    {
      key: 'entrega',
      header: 'Comuna y fecha',
      render: (o) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', whiteSpace: 'normal', minWidth: 100, maxWidth: 130 }}>
          <span>{o.comuna ?? '—'}</span>
          <span className="rh-num" style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            {formatearFechaPedido(o.fechaPedido)}
          </span>
          {o.comunaRevisar && chip('Revisar comuna', 'aviso')}
        </div>
      ),
    },
    ...ETAPAS.map<Column<OrdenFabricacion>>((e) => ({
      key: e.id,
      header: e.etiqueta,
      align: 'center',
      render: (o) => casilla(o, e.id, e.etiqueta, false),
    })),
  ]

  /* ---------------- Contenido principal ---------------- */
  const sistemaVacio = totalSistema === 0

  const estadoVacio = (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'var(--space-3)', padding: 'var(--space-8) var(--space-4)' }}>
        <span
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--arena-200)',
            color: 'var(--nogal-600)',
          }}
        >
          <Factory size={26} />
        </span>
        <h3 style={{ font: 'var(--type-h3)', color: 'var(--text-strong)' }}>Aún no hay órdenes de fabricación</h3>
        <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)', maxWidth: 460 }}>
          Cada mueble de cada pedido de Shopify aparecerá aquí, con sus casillas B, I, A, C y LISTO para marcar el avance. Todavía no se ha importado
          ninguno.
        </p>
      </div>
    </Card>
  )

  const sinResultados = (
    <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', color: 'var(--text-muted)', font: 'var(--type-body)' }}>
      {fechasInvertidas ? 'Corrige las fechas para ver órdenes.' : 'Ninguna orden coincide con estos filtros.'}
      {nFiltros > 0 && !fechasInvertidas && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button size="sm" variant="secondary" iconLeft={<FilterX size={15} />} onClick={() => cambiarFiltros({ ...FILTROS_ORDENES_VACIOS, incluirAdicionales: filtros.incluirAdicionales })}>
            Limpiar filtros
          </Button>
        </div>
      )}
    </div>
  )

  const avisos = (
    <>
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}
      {errorEtapa && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span role="alert" style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            {errorEtapa}
          </span>
        </Card>
      )}
      {avisoExportacion && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: avisoExportacion.tipo === 'ok' ? 'var(--state-success)' : 'var(--state-danger)' }}>
          <span
            role={avisoExportacion.tipo === 'error' ? 'alert' : 'status'}
            style={{ font: 'var(--type-body)', color: avisoExportacion.tipo === 'ok' ? 'var(--text-strong)' : 'var(--state-danger)' }}
          >
            {avisoExportacion.texto}
          </span>
        </Card>
      )}
      {limitado && (
        <Card padding="var(--space-3) var(--space-5)" tone="sunken">
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            Se muestran las {LIMITE_ORDENES} órdenes más recientes. Acota las fechas o usa los filtros para ver el resto.
          </span>
        </Card>
      )}
    </>
  )

  if (sistemaVacio) {
    return (
      <>
        {avisos}
        {resumen}
        {estadoVacio}
      </>
    )
  }

  const subtituloListado = cargando ? 'Cargando...' : `${ordenes.length} ${ordenes.length === 1 ? 'orden' : 'órdenes'}`

  return (
    <>
      {avisos}
      {resumen}
      {tarjetaFiltros}

      {esEscritorio ? (
        <Card padding="0" title="Órdenes de fabricación" subtitle={subtituloListado}>
          {!cargando && ordenes.length === 0 ? (
            sinResultados
          ) : (
            <DataTable compacta rows={ordenes} columns={columnas} onRowClick={abrir} emptyLabel="Cargando órdenes..." />
          )}
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {cargando && ordenes.length === 0 && (
            <Card>
              <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando órdenes...</span>
            </Card>
          )}
          {!cargando && ordenes.length === 0 && <Card>{sinResultados}</Card>}
          {ordenes.map((o) => (
            <Card key={o.id} padding="var(--space-4)">
              <div onClick={() => abrir(o)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span className="rh-num" style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                        {o.numero}
                      </span>
                      {o.origen === 'manual_shopify' && chip('Manual', 'neutro')}
                      {o.esAdicional && chip('Adicional', 'neutro')}
                    </div>
                    <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{o.modelo ?? '—'}</div>
                    {subtitulo(o) && <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{subtitulo(o)}</div>}
                  </div>
                  <EstadoOrdenBadge estado={o.estado} />
                </div>
                {(preparadoPorShopify(o) || shopifyDesmarco(o)) && (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                    {preparadoPorShopify(o) && chip('Preparado en Shopify', 'neutro')}
                    {shopifyDesmarco(o) && chip('Shopify ya no lo tiene preparado', 'aviso')}
                  </div>
                )}
                <div style={{ font: 'var(--type-caption)', color: 'var(--text-body)', marginTop: 'var(--space-2)' }}>
                  {[o.cm, o.color, o.tela].filter(Boolean).join(' · ') || '—'}
                </div>
                {(faltaColorTela(o) || mencionaPatas(o)) && (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                    {faltaColorTela(o) && chip(`Falta ${faltaColorTela(o)}`, 'aviso')}
                    {mencionaPatas(o) && chip('Patas en la nota', 'aviso')}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                  <span>
                    {o.comuna ?? '—'} · {formatearFechaPedido(o.fechaPedido)}
                  </span>
                  {o.comunaRevisar && chip('Revisar comuna', 'aviso')}
                </div>
                {o.notasProduccion && (
                  <div style={{ font: 'var(--type-caption)', color: 'var(--text-body)', marginTop: 'var(--space-2)' }}>{o.notasProduccion}</div>
                )}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr 1.9fr',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-3)',
                }}
              >
                {ETAPAS.map((e) => casilla(o, e.id, e.etiqueta, true))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
