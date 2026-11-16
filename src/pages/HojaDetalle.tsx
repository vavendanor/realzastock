import { ArrowLeft, FileDown, Pencil, RotateCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AgregarPedidoPorNumero } from '../components/AgregarPedidoPorNumero'
import { Shell } from '../components/layout/Shell'
import { VistaPorModelo, VistaPorPedido } from '../components/PiezasDeHoja'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Dialogo } from '../components/ui/Dialogo'
import { Input } from '../components/ui/Input'
import { useCambiosPendientes } from '../hooks/useCambiosPendientes'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { crearCalendario, hoyEnChile, type Calendario } from '../lib/diasHabiles'
import { leerCalendario } from '../lib/feriados'
import {
  agregarPedidoAHoja,
  eliminarHoja,
  errorDeNombre,
  fijarInicioPlazo,
  listarPedidosDeHoja,
  listarPiezasDeHoja,
  MAX_NOMBRE_HOJA,
  obtenerHoja,
  quitarPedidoDeHoja,
  renombrarHoja,
  type HojaGuardada,
} from '../lib/hojas'
import { construirListaPendiente, descargarArchivo, generarLibroListaPendiente, nombreArchivoLista } from '../lib/listaPendiente'
import { agruparPorModelo, agruparPorPedido, resumirHoja } from '../lib/vistasDeHoja'
import type { OrdenFabricacion } from '../types'

type Vista = 'pedido' | 'modelo'

const mensajeDe = (err: unknown, porDefecto: string) => (err instanceof Error ? err.message : porDefecto)
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/* Una hoja de fabricación: sus pedidos y piezas en vivo, en dos vistas. Se puede renombrar, agregar y
   quitar pedidos, cambiar desde cuándo corre el plazo de un pedido, exportar la lista pendiente a Excel
   y eliminar la hoja. Las casillas usan el mismo guardado diferido que Pedidos. Solo administrador y
   bodega llegan hasta aquí (ruta protegida y políticas de la base de datos). */
export function HojaDetalle() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()
  const cp = useCambiosPendientes()
  const { conciliar, suscribirRecarga } = cp

  const [hoja, setHoja] = useState<HojaGuardada | null>(null)
  const [piezas, setPiezas] = useState<OrdenFabricacion[]>([])
  const [asignados, setAsignados] = useState<string[]>([])
  const [calendario, setCalendario] = useState<Calendario>(() => crearCalendario([]))
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('pedido')

  const [renombrando, setRenombrando] = useState(false)
  const [nombre, setNombre] = useState('')
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false)
  const [eliminando, setEliminando] = useState(false)
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const hoy = hoyEnChile()

  /* `silenciosa`: se vuelve a pedir sin poner "Cargando..." (tras guardar o cambiar algo). */
  const cargar = useCallback(
    async (silenciosa = false) => {
      if (!silenciosa) setCargando(true)
      setError(null)
      try {
        const h = await obtenerHoja(id)
        setHoja(h)
        if (h) {
          const [ordenes, pedidos, feriados] = await Promise.all([listarPiezasDeHoja(id), listarPedidosDeHoja(id), leerCalendario()])
          setPiezas(ordenes)
          setAsignados(pedidos)
          setCalendario(feriados)
        }
      } catch (err) {
        setError(mensajeDe(err, 'No se pudo cargar la hoja.'))
      } finally {
        setCargando(false)
      }
    },
    [id],
  )

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    conciliar(piezas)
  }, [piezas, conciliar])

  /* Después de guardar casillas, se vuelve a pedir lo que dice el servidor. */
  useEffect(() => suscribirRecarga(() => void cargar(true)), [suscribirRecarga, cargar])

  const porPedido = useMemo(() => agruparPorPedido(piezas, asignados), [piezas, asignados])
  const porModelo = useMemo(() => agruparPorModelo(piezas), [piezas])
  const resumen = useMemo(() => resumirHoja(piezas, asignados), [piezas, asignados])
  const cancelados = porPedido.filter((g) => g.cancelado)

  const guardarNombre = async () => {
    const problema = errorDeNombre(nombre)
    if (problema) return setErrorNombre(problema)
    try {
      await renombrarHoja(id, nombre)
      setRenombrando(false)
      setErrorNombre(null)
      await cargar(true)
    } catch (err) {
      setErrorNombre(mensajeDe(err, 'No se pudo cambiar el nombre.'))
    }
  }

  const quitarPedido = async (pedido: string) => {
    await quitarPedidoDeHoja(id, pedido)
    await cargar(true)
  }

  const eliminar = async () => {
    setEliminando(true)
    setErrorEliminar(null)
    try {
      await eliminarHoja(id)
      navigate('/hojas')
    } catch (err) {
      setErrorEliminar(mensajeDe(err, 'No se pudo eliminar la hoja.'))
      setEliminando(false)
    }
  }

  /* El Excel se arma con lo último que dice el servidor (no con lo que haya en pantalla). */
  const exportar = async () => {
    if (!hoja) return
    setExportando(true)
    setAviso(null)
    try {
      const [ordenes, feriados] = await Promise.all([listarPiezasDeHoja(id), leerCalendario()])
      const lista = construirListaPendiente(ordenes, feriados, hoy)
      if (lista.piezas === 0) throw new Error('La hoja no tiene piezas por fabricar: no hay nada que exportar.')
      const archivo = nombreArchivoLista(hoja.nombre, hoy)
      descargarArchivo(await generarLibroListaPendiente(lista, hoy), archivo)
      setAviso({
        tipo: 'ok',
        texto: `Se descargó ${archivo} con ${plural(lista.pedidos, 'pedido', 'pedidos')} y ${plural(lista.piezas, 'pieza', 'piezas')}.${lista.sinCalendario ? ' Faltan feriados de algún año: los días hábiles pueden no ser exactos.' : ''}`,
      })
    } catch (err) {
      setAviso({ tipo: 'error', texto: mensajeDe(err, 'No se pudo generar el archivo.') })
    } finally {
      setExportando(false)
    }
  }

  const acciones = (
    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <Button variant="secondary" aria-label="Recargar" iconLeft={<RotateCw size={15} />} onClick={() => void cargar(true)}>
        {esEscritorio ? 'Recargar' : ''}
      </Button>
      {hoja && (
        <Button iconLeft={<FileDown size={15} />} disabled={exportando} onClick={() => void exportar()}>
          {exportando ? 'Generando...' : esEscritorio ? 'Exportar a Excel' : 'Excel'}
        </Button>
      )}
    </div>
  )

  if (!cargando && !hoja) {
    return (
      <Shell eyebrow="OPERACIÓN" title="Hoja de fabricación">
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <span role={error ? 'alert' : undefined} style={{ font: 'var(--type-body)', color: error ? 'var(--state-danger)' : 'var(--text-body)' }}>
              {error ?? 'No se encontró esta hoja. Puede que la hayan eliminado.'}
            </span>
            <Link to="/hojas">Volver a las hojas</Link>
          </div>
        </Card>
      </Shell>
    )
  }

  return (
    <Shell eyebrow="OPERACIÓN" title={hoja?.nombre ?? 'Hoja de fabricación'} actions={acciones}>
      <Link to="/hojas" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', font: 'var(--type-caption)' }}>
        <ArrowLeft size={14} /> Hojas de fabricación
      </Link>

      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span role="alert" style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            {error}
          </span>
        </Card>
      )}
      {aviso && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: aviso.tipo === 'ok' ? 'var(--state-success)' : 'var(--state-danger)' }}>
          <span role={aviso.tipo === 'error' ? 'alert' : 'status'} data-aviso-exportacion={aviso.tipo} style={{ font: 'var(--type-body)', color: aviso.tipo === 'ok' ? 'var(--text-strong)' : 'var(--state-danger)' }}>
            {aviso.texto}
          </span>
        </Card>
      )}

      {cargando && !hoja ? (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando hoja...</span>
        </Card>
      ) : (
        hoja && (
          <>
            <Card
              title="Datos de la hoja"
              subtitle={`${plural(resumen.pedidos, 'pedido', 'pedidos')} · ${plural(resumen.piezas, 'pieza', 'piezas')} · ${resumen.pendientes} por fabricar`}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                {renombrando ? (
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Input
                      label="Nombre de la hoja"
                      value={nombre}
                      maxLength={MAX_NOMBRE_HOJA + 20}
                      onChange={(e) => {
                        setNombre(e.target.value)
                        setErrorNombre(null)
                      }}
                      error={errorNombre ?? (nombre.trim().length > MAX_NOMBRE_HOJA ? (errorDeNombre(nombre) ?? undefined) : undefined)}
                      wrapperStyle={{ flex: '1 1 260px' }}
                    />
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 28 }}>
                      <Button disabled={errorDeNombre(nombre) !== null} onClick={() => void guardarNombre()}>
                        Guardar nombre
                      </Button>
                      <Button variant="ghost" onClick={() => setRenombrando(false)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                    <span style={{ font: 'var(--type-body)', color: 'var(--text-body)', overflowWrap: 'anywhere' }}>
                      Nombre: <strong>{hoja.nombre}</strong>
                    </span>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        iconLeft={<Pencil size={14} />}
                        onClick={() => {
                          setNombre(hoja.nombre)
                          setErrorNombre(null)
                          setRenombrando(true)
                        }}
                      >
                        Renombrar
                      </Button>
                      <Button size="sm" variant="secondary" iconLeft={<Trash2 size={14} />} onClick={() => setConfirmandoEliminar(true)}>
                        Eliminar hoja
                      </Button>
                    </div>
                  </div>
                )}

                <AgregarPedidoPorNumero
                  incluidos={new Set(asignados)}
                  alAgregar={async (r) => {
                    await agregarPedidoAHoja(id, r.pedidoNumero)
                    await cargar(true)
                  }}
                />
              </div>
            </Card>

            {cancelados.map((g) => (
              <Card key={g.pedido} padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-warning)' }}>
                <div data-pedido-cancelado={g.pedido} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span role="alert" style={{ font: 'var(--type-body)', color: 'var(--text-strong)' }}>
                    El pedido {g.pedido} fue cancelado: ya no tiene piezas para fabricar.
                  </span>
                  <Button size="sm" variant="secondary" aria-label={`Quitar el pedido cancelado ${g.pedido} de la hoja`} onClick={() => void quitarPedido(g.pedido).catch((err) => setError(mensajeDe(err, 'No se pudo quitar el pedido.')))}>
                    Quitar de la hoja
                  </Button>
                </div>
              </Card>
            ))}

            <div role="tablist" aria-label="Vista de la hoja" style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {(
                [
                  ['pedido', 'Por N° de pedido'],
                  ['modelo', 'Por modelo y medidas'],
                ] as const
              ).map(([v, etiqueta]) => (
                <Button key={v} role="tab" aria-selected={vista === v} variant={vista === v ? 'primary' : 'secondary'} onClick={() => setVista(v)}>
                  {etiqueta}
                </Button>
              ))}
            </div>

            {vista === 'pedido' ? (
              <VistaPorPedido
                grupos={porPedido}
                calendario={calendario}
                hoy={hoy}
                alQuitar={quitarPedido}
                alFijarInicio={async (pedido, fecha) => {
                  await fijarInicioPlazo(pedido, fecha)
                  await cargar(true)
                }}
              />
            ) : (
              <VistaPorModelo grupos={porModelo} calendario={calendario} hoy={hoy} />
            )}
          </>
        )
      )}

      {confirmandoEliminar && hoja && (
        <Dialogo
          titulo={`¿Eliminar la hoja «${hoja.nombre}»?`}
          alCancelar={() => setConfirmandoEliminar(false)}
          acciones={
            <>
              <Button data-inicial variant="secondary" disabled={eliminando} onClick={() => setConfirmandoEliminar(false)}>
                Cancelar
              </Button>
              <Button variant="danger" disabled={eliminando} onClick={() => void eliminar()}>
                {eliminando ? 'Eliminando...' : 'Eliminar hoja'}
              </Button>
            </>
          }
        >
          <p style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>
            Se elimina la hoja con su lista de {plural(resumen.pedidos, 'pedido', 'pedidos')}. Los pedidos y su avance no se tocan.
          </p>
          {errorEliminar && (
            <p role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-danger)', marginTop: 'var(--space-3)' }}>
              {errorEliminar}
            </p>
          )}
        </Dialogo>
      )}
    </Shell>
  )
}
