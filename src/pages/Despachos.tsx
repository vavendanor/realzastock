import { RotateCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BotonComprobante } from '../components/BotonComprobante'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Dialogo } from '../components/ui/Dialogo'
import { EstadoOrdenBadge } from '../components/ui/EstadoOrdenBadge'
import { Input } from '../components/ui/Input'
import { useCambiosPendientes } from '../hooks/useCambiosPendientes'
import { hoyEnChile } from '../lib/diasHabiles'
import {
  agruparPorDestino,
  agruparPorFecha,
  destinoDe,
  esDespachable,
  etiquetaDeFecha,
  listarMueblesDeDespachos,
  listarMueblesDePedidos,
  marcarDespachado,
  partesDePedidos,
  programarDespacho,
  quitarDespachoProgramado,
  textoDePartes,
  type PartesDePedido,
} from '../lib/despachos'
import { ladoDeLista, medidaDeLista, modeloDeLista, telaDeLista } from '../lib/excelHoja'
import type { OrdenFabricacion } from '../types'

type Vista = 'por_despachar' | 'por_fecha'

const mensajeDe = (err: unknown, porDefecto: string) => (err instanceof Error ? err.message : porDefecto)
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const fechaCorta = (f: string) => f.split('-').reverse().join('-')
/* Los despachos ya salidos se muestran hasta 30 días atrás. */
const hace30Dias = (hoy: string) => new Date(Date.parse(`${hoy}T12:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
const manana = (hoy: string) => new Date(Date.parse(`${hoy}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

const chip = (texto: string, tono: 'aviso' | 'neutro' | 'rojo') => (
  <span
    key={texto}
    style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      font: 'var(--fw-bold) var(--text-body-xs)/1.3 var(--font-sans)',
      background: tono === 'aviso' ? 'var(--state-warning-soft)' : tono === 'rojo' ? 'var(--state-danger-soft)' : 'var(--arena-300)',
      color: tono === 'aviso' ? 'var(--tinta-700)' : tono === 'rojo' ? 'var(--state-danger)' : 'var(--text-muted)',
      whiteSpace: 'nowrap',
    }}
  >
    {texto}
  </span>
)

interface FilaProps {
  mueble: OrdenFabricacion
  partes: PartesDePedido | undefined
  /* Se puede elegir (no, si ya salió o tiene casillas sin guardar). */
  seleccionable: boolean
  marcado: boolean
  alAlternar: () => void
  /* En la vista por fecha, a qué destino va (la comuna ya no es el título del grupo). */
  mostrarDestino?: boolean
}

function FilaMueble({ mueble: o, partes, seleccionable, marcado, alAlternar, mostrarDestino = false }: FilaProps) {
  const cp = useCambiosPendientes()
  const salido = o.estado !== 'fabricado'
  const destino = destinoDe(o.comuna)
  const aviso = textoDePartes(partes)
  const sinGuardar = cp.hayCambios(o.id)
  return (
    <div
      data-mueble={o.numero}
      data-salido={salido ? 'si' : undefined}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        background: salido ? 'var(--arena-100)' : 'var(--surface-card)',
        opacity: salido ? 0.6 : 1,
      }}
    >
      <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, minHeight: 32, cursor: seleccionable ? 'pointer' : 'not-allowed' }}>
        <input
          type="checkbox"
          checked={marcado}
          disabled={!seleccionable}
          aria-label={`Elegir ${o.numero} para despachar`}
          title={sinGuardar ? 'Guarda primero los cambios de casillas de este mueble (barra de abajo)' : undefined}
          onChange={alAlternar}
          style={{ width: 18, height: 18, accentColor: 'var(--action-accent)', margin: 0 }}
        />
      </label>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong className="rh-num" style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
            {o.numero}
          </strong>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>
            {[modeloDeLista(o), medidaDeLista(o.cm).medida, ladoDeLista(o.orientacion)].filter(Boolean).join(' · ')}
          </span>
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{telaDeLista(o)}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 4 }}>
          {mostrarDestino && chip(destino === 'retiro' ? 'Retiro en tienda' : destino === 'sin_direccion' ? 'Sin dirección' : (o.comuna ?? ''), destino === 'ruta' ? 'neutro' : 'aviso')}
          {o.despachoProgramado && !salido && !mostrarDestino && chip(`Programado ${fechaCorta(o.despachoProgramado)}`, 'neutro')}
          {aviso && chip(aviso, 'aviso')}
          {sinGuardar && chip('Cambios sin guardar', 'aviso')}
        </div>
      </div>
      <EstadoOrdenBadge estado={cp.ordenEfectiva(o).estado} />
    </div>
  )
}

interface GrupoProps {
  titulo: string
  subtitulo?: string
  muebles: OrdenFabricacion[]
  partes: ReadonlyMap<string, PartesDePedido>
  elegidos: ReadonlySet<string>
  seleccionable: (o: OrdenFabricacion) => boolean
  alAlternar: (ids: readonly string[], elegir?: boolean) => void
  mostrarDestino?: boolean
  /* Un gancho para poner algo bajo la lista (los comprobantes). */
  pie?: ReactNode
  etiquetaExtra?: ReactNode
}

function GrupoDeMuebles({ titulo, subtitulo, muebles, partes, elegidos, seleccionable, alAlternar, mostrarDestino, pie, etiquetaExtra }: GrupoProps) {
  const elegibles = muebles.filter(seleccionable)
  const todos = elegibles.length > 0 && elegibles.every((o) => elegidos.has(o.id))
  return (
    <Card
      padding="0"
      aria-label={titulo}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {elegibles.length > 0 && (
            <input
              type="checkbox"
              checked={todos}
              aria-label={`Elegir todos los muebles de ${titulo}`}
              onChange={() => alAlternar(elegibles.map((o) => o.id), !todos)}
              style={{ width: 18, height: 18, accentColor: 'var(--action-accent)', margin: 0 }}
            />
          )}
          {titulo}
          {etiquetaExtra}
        </span>
      }
      subtitle={subtitulo ?? plural(muebles.length, 'mueble', 'muebles')}
    >
      {muebles.map((o) => (
        <FilaMueble
          key={o.id}
          mueble={o}
          partes={partes.get(o.pedidoNumero)}
          seleccionable={seleccionable(o)}
          marcado={elegidos.has(o.id)}
          alAlternar={() => alAlternar([o.id])}
          mostrarDestino={mostrarDestino}
        />
      ))}
      {pie}
    </Card>
  )
}

/* Despachos: qué muebles fabricados esperan entrega (por comuna, sin dirección y retiros en tienda), programar su
   fecha de salida, verlos por fecha, quitarlos de una fecha y marcarlos como despachados. Solo administrador y bodega
   llegan hasta aquí (ruta protegida y políticas de la base de datos). */
export function Despachos() {
  const cp = useCambiosPendientes()
  const { conciliar, suscribirRecarga } = cp
  const hoy = hoyEnChile()

  const [ordenes, setOrdenes] = useState<OrdenFabricacion[]>([])
  const [partes, setPartes] = useState<ReadonlyMap<string, PartesDePedido>>(() => new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('por_despachar')
  const [elegidosIds, setElegidos] = useState<ReadonlySet<string>>(() => new Set())
  const [fecha, setFecha] = useState(() => manana(hoy))
  const [trabajando, setTrabajando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string; comprobantes?: { pedido: string; ordenId: string }[] } | null>(null)

  const cargar = useCallback(async (silenciosa = false) => {
    if (!silenciosa) setCargando(true)
    setError(null)
    try {
      const muebles = await listarMueblesDeDespachos(hace30Dias(hoyEnChile()))
      setOrdenes(muebles)
      setPartes(partesDePedidos(await listarMueblesDePedidos([...new Set(muebles.map((o) => o.pedidoNumero))])))
    } catch (err) {
      setError(mensajeDe(err, 'No se pudieron cargar los despachos.'))
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    conciliar(ordenes)
  }, [ordenes, conciliar])

  /* Después de guardar casillas desde la barra de abajo, se vuelve a pedir lo que dice el servidor. */
  useEffect(() => suscribirRecarga(() => void cargar(true)), [suscribirRecarga, cargar])

  const porDestino = useMemo(() => agruparPorDestino(ordenes), [ordenes])
  const porFecha = useMemo(() => agruparPorFecha(ordenes), [ordenes])
  const totalPorDespachar = ordenes.filter(esDespachable).length
  const totalProgramados = porFecha.reduce((s, g) => s + g.porSalir.length, 0)

  /* Se puede elegir un mueble que sigue fabricado y no tiene casillas sin guardar (cambiaría su estado). */
  const seleccionable = useCallback((o: OrdenFabricacion) => esDespachable(o) && !cp.hayCambios(o.id), [cp])
  const elegidos = useMemo(() => ordenes.filter((o) => elegidosIds.has(o.id) && seleccionable(o)), [ordenes, elegidosIds, seleccionable])
  const idsElegidos = elegidos.map((o) => o.id)
  const idsSet = useMemo(() => new Set(elegidos.map((o) => o.id)), [elegidos])
  const conFecha = elegidos.filter((o) => o.despachoProgramado)

  const alternar = (ids: readonly string[], elegir?: boolean) =>
    setElegidos((previos) => {
      const nuevos = new Set(previos)
      for (const id of ids) {
        const poner = elegir ?? !nuevos.has(id)
        if (poner) nuevos.add(id)
        else nuevos.delete(id)
      }
      return nuevos
    })

  const ejecutar = async (accion: () => Promise<unknown>, ok: Omit<NonNullable<typeof aviso>, 'tipo'>) => {
    setTrabajando(true)
    setAviso(null)
    try {
      await accion()
      setElegidos(new Set())
      await cargar(true)
      setAviso({ tipo: 'ok', ...ok })
    } catch (err) {
      setAviso({ tipo: 'error', texto: mensajeDe(err, 'No se pudo completar la acción.') })
      void cargar(true)
    } finally {
      setTrabajando(false)
      setConfirmando(false)
    }
  }

  const programar = () =>
    ejecutar(() => programarDespacho(idsElegidos, fecha), { texto: `Se programaron ${plural(idsElegidos.length, 'mueble', 'muebles')} para el ${etiquetaDeFecha(fecha)}.` })
  const quitarFecha = () =>
    ejecutar(() => quitarDespachoProgramado(conFecha.map((o) => o.id)), { texto: `Se quitó la fecha de ${plural(conFecha.length, 'mueble', 'muebles')}.` })
  const despachar = () => {
    const porPedido = new Map<string, string>()
    for (const o of elegidos) if (!porPedido.has(o.pedidoNumero)) porPedido.set(o.pedidoNumero, o.id)
    return ejecutar(() => marcarDespachado(idsElegidos), {
      texto: `Se marcaron como despachados ${plural(idsElegidos.length, 'mueble', 'muebles')}. Ahora están "En despacho".`,
      comprobantes: [...porPedido].map(([pedido, ordenId]) => ({ pedido, ordenId })),
    })
  }

  const fechaInvalida = !fecha || fecha < hoy

  return (
    <Shell
      eyebrow="OPERACIÓN"
      title="Despachos"
      actions={
        <Button variant="secondary" aria-label="Recargar" iconLeft={<RotateCw size={15} />} onClick={() => void cargar(true)}>
          Recargar
        </Button>
      }
    >
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span role="alert" style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            {error}
          </span>
        </Card>
      )}

      {aviso && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: aviso.tipo === 'ok' ? 'var(--state-success)' : 'var(--state-danger)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <span data-aviso-despacho={aviso.tipo} role={aviso.tipo === 'error' ? 'alert' : 'status'} style={{ font: 'var(--type-body)', color: aviso.tipo === 'ok' ? 'var(--text-strong)' : 'var(--state-danger)' }}>
              {aviso.texto}
            </span>
            {aviso.comprobantes && (
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Comprobantes de despacho:</span>
                {aviso.comprobantes.map((c) => (
                  <BotonComprobante key={c.pedido} ordenId={c.ordenId} pedido={c.pedido} />
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      <div role="tablist" aria-label="Vista de despachos" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {(
          [
            ['por_despachar', `Por despachar (${totalPorDespachar})`],
            ['por_fecha', `Programados por fecha (${totalProgramados})`],
          ] as const
        ).map(([v, etiqueta]) => (
          <Button key={v} role="tab" aria-selected={vista === v} variant={vista === v ? 'primary' : 'secondary'} onClick={() => setVista(v)}>
            {etiqueta}
          </Button>
        ))}
      </div>

      {cargando && ordenes.length === 0 && (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando despachos...</span>
        </Card>
      )}

      {vista === 'por_despachar' && !cargando && (
        <>
          {totalPorDespachar === 0 && (
            <Card>
              <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>No hay muebles fabricados esperando entrega.</span>
            </Card>
          )}
          {porDestino.rutas.map((g) => (
            <GrupoDeMuebles key={g.clave} titulo={g.nombre} muebles={g.muebles} partes={partes} elegidos={idsSet} seleccionable={seleccionable} alAlternar={alternar} />
          ))}
          {porDestino.sinDireccion.length > 0 && (
            <GrupoDeMuebles titulo="Sin dirección" subtitulo={`${plural(porDestino.sinDireccion.length, 'mueble', 'muebles')} · falta la dirección de entrega`} muebles={porDestino.sinDireccion} partes={partes} elegidos={idsSet} seleccionable={seleccionable} alAlternar={alternar} />
          )}
          {porDestino.retiros.length > 0 && (
            <GrupoDeMuebles titulo="Retiro en tienda" subtitulo={`${plural(porDestino.retiros.length, 'mueble', 'muebles')} · fuera de las rutas`} muebles={porDestino.retiros} partes={partes} elegidos={idsSet} seleccionable={seleccionable} alAlternar={alternar} />
          )}
        </>
      )}

      {vista === 'por_fecha' && !cargando && (
        <>
          {porFecha.length === 0 && (
            <Card>
              <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>No hay despachos programados. Elige muebles en "Por despachar" y programa una fecha.</span>
            </Card>
          )}
          {porFecha.map((g) => {
            const pedidosSalidos = [...new Map(g.salidos.map((o) => [o.pedidoNumero, o.id])).entries()]
            const etiqueta = g.fecha === hoy ? 'Hoy' : g.fecha === manana(hoy) ? 'Mañana' : null
            return (
              <GrupoDeMuebles
                key={g.fecha}
                titulo={`${etiqueta ? `${etiqueta} · ` : ''}${etiquetaDeFecha(g.fecha)}`}
                subtitulo={`${plural(g.porSalir.length, 'mueble por salir', 'muebles por salir')} · ${plural(g.salidos.length, 'ya salió', 'ya salieron')}`}
                muebles={[...g.porSalir, ...g.salidos]}
                partes={partes}
                elegidos={idsSet}
                seleccionable={seleccionable}
                alAlternar={alternar}
                mostrarDestino
                etiquetaExtra={g.fecha < hoy && g.porSalir.length > 0 ? chip('Atrasado', 'rojo') : undefined}
                pie={
                  pedidosSalidos.length > 0 ? (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', padding: 'var(--space-3) var(--space-4)' }}>
                      <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Comprobantes de lo que ya salió:</span>
                      {pedidosSalidos.map(([pedido, ordenId]) => (
                        <BotonComprobante key={pedido} ordenId={ordenId} pedido={pedido} />
                      ))}
                    </div>
                  ) : undefined
                }
              />
            )
          })}
        </>
      )}

      {/* Al final del contenido: pegada al borde de abajo mientras se recorre la lista (sticky). */}
      {elegidos.length > 0 && (
        <Card padding="var(--space-4) var(--space-5)" style={{ position: 'sticky', bottom: 0, zIndex: 5, borderColor: 'var(--action-accent)', boxShadow: 'var(--shadow-md, 0 -4px 16px rgba(0,0,0,.12))' }}>
          <div data-barra-despacho style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <strong style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)', alignSelf: 'center' }}>
              {plural(elegidos.length, 'mueble elegido', 'muebles elegidos')}
            </strong>
            <Input label="Fecha del despacho" type="date" size="sm" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} wrapperStyle={{ minWidth: 170 }} error={fecha && fecha < hoy ? 'No puede ser anterior a hoy.' : undefined} />
            <Button size="sm" disabled={trabajando || fechaInvalida} onClick={() => void programar()}>
              Programar despacho
            </Button>
            {conFecha.length > 0 && (
              <Button size="sm" variant="secondary" disabled={trabajando} onClick={() => void quitarFecha()}>
                Quitar de la fecha ({conFecha.length})
              </Button>
            )}
            <Button size="sm" variant="accent" disabled={trabajando} onClick={() => setConfirmando(true)}>
              Marcar como despachado
            </Button>
            <Button size="sm" variant="ghost" disabled={trabajando} onClick={() => setElegidos(new Set())}>
              Limpiar selección
            </Button>
          </div>
        </Card>
      )}

      {confirmando && (
        <Dialogo
          titulo={`¿Marcar ${plural(elegidos.length, 'mueble', 'muebles')} como despachados?`}
          alCancelar={() => setConfirmando(false)}
          acciones={
            <>
              <Button data-inicial variant="secondary" disabled={trabajando} onClick={() => setConfirmando(false)}>
                Volver
              </Button>
              <Button variant="accent" disabled={trabajando} onClick={() => void despachar()}>
                {trabajando ? 'Marcando...' : `Marcar ${elegidos.length} despachados`}
              </Button>
            </>
          }
        >
          <p style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>
            Pasan a "En despacho" y se guarda la hora de salida. Pedidos: {[...new Set(elegidos.map((o) => o.pedidoNumero))].join(', ')}.
          </p>
        </Dialogo>
      )}
    </Shell>
  )
}
