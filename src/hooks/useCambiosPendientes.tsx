import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { AvisoSalida } from '../components/AvisoSalida'
import { ConfirmarGuardado } from '../components/ConfirmarGuardado'
import { esRutaDeProduccion } from '../components/layout/navegacion'
import {
  clave,
  claveAlmacen,
  conciliar as conciliarPendientes,
  deserializar,
  MAX_CAMBIOS,
  marcarCambio,
  ordenEfectiva as ordenConCambios,
  ordenTieneCambios,
  pendientesVacios,
  plural,
  quitarClaves,
  resumir,
  serializar,
  tituloConContador,
  valorEfectivo as valorConCambios,
  type Pendientes,
  type ProblemaConPendiente,
  type Resumen,
} from '../lib/cambiosPendientes'
import { guardarConReintentos } from '../lib/guardarCambios'
import { etapaMarcada } from '../lib/ordenes'
import type { Etapa, OrdenFabricacion } from '../types'
import { useAuth } from './useAuth'

/* Almacén de los cambios de casillas (B, I, A, C y LISTO) que todavía no se
   guardaron. Es uno solo para toda la app: Pedidos, el detalle de un mueble y las
   hojas ven lo mismo, y nada se pierde al moverse entre ellas.

   Lo que hace, además de guardar la lista:
     * Guarda los pendientes en el navegador (por usuario, caducan a los 7 días)
       para recuperarlos si se cierra la pestaña o el celular mata la app.
     * Pone el contador en el título de la pestaña: "(7) Realza Hogar".
     * Avisa antes de recargar o cerrar la página, de salir del módulo de
       producción y de cerrar sesión.
   La lógica de las decisiones está en lib/cambiosPendientes.ts y
   lib/guardarCambios.ts (se prueban por separado). */

export interface Aviso {
  tipo: 'ok' | 'error'
  texto: string
}

interface CambiosPendientesContexto {
  pendientes: Pendientes
  total: number
  muebles: number
  resumen: Resumen
  guardando: boolean
  /* Cambios que el servidor rechazó la última vez (la orden salió a despacho, fue cancelada...). */
  problemas: ProblemaConPendiente[]
  /* Cuántos cambios ya no se podrían guardar (la orden ya no admite cambios). */
  noAplicables: number
  aviso: Aviso | null
  /* Cuántos cambios se recuperaron de una sesión anterior (0 si ninguno o si ya se vio). */
  restaurados: number

  /* Lo que debe MOSTRAR cada casilla: el cambio pendiente si lo hay, si no el valor del servidor. */
  valorEfectivo: (orden: OrdenFabricacion, etapa: Etapa) => boolean
  ordenEfectiva: (orden: OrdenFabricacion) => OrdenFabricacion
  hayCambios: (ordenId: string) => boolean
  esPendiente: (ordenId: string, etapa: Etapa) => boolean
  esProblema: (ordenId: string, etapa: Etapa) => boolean

  /* `orden` es la del SERVIDOR (no la que muestra la pantalla con los cambios encima). */
  marcar: (orden: OrdenFabricacion, etapa: Etapa, valor: boolean) => void
  descartar: () => void
  descartarProblemas: () => void
  guardar: () => Promise<void>
  /* Cada pantalla llama a esto al cargar órdenes: quita los cambios que el servidor ya cumplió. */
  conciliar: (ordenes: readonly OrdenFabricacion[]) => void
  /* Para que las pantallas recarguen sus datos después de guardar. */
  suscribirRecarga: (alRecargar: () => void) => () => void

  confirmando: boolean
  abrirConfirmacion: () => void
  cerrarConfirmacion: () => void
  cerrarAviso: () => void
  cerrarRestaurados: () => void
  /* Cierra la sesión, avisando antes si hay cambios sin guardar. */
  cerrarSesionSegura: () => void
}

const Contexto = createContext<CambiosPendientesContexto | undefined>(undefined)

const firmaDe = (p: Pendientes) => JSON.stringify([...p.values()])
const sinClaves = <T,>(conjunto: ReadonlySet<T>, fuera: (x: T) => boolean) => new Set([...conjunto].filter((x) => !fuera(x)))
const mismoConjunto = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x))

export function CambiosPendientesProvider({ children }: { children: ReactNode }) {
  const { user, cerrarSesion } = useAuth()
  const usuarioId = user?.id ?? null

  const [pendientes, setPendientes] = useState<Pendientes>(pendientesVacios)
  const [problemasServidor, setProblemas] = useState<ProblemaConPendiente[]>([])
  const [noAplicablesSet, setNoAplicables] = useState<ReadonlySet<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [restaurados, setRestaurados] = useState(0)
  const [confirmando, setConfirmando] = useState(false)
  const [saliendoDeSesion, setSaliendoDeSesion] = useState(false)
  /* El usuario de quien ya se leyó lo guardado: hasta entonces no se escribe nada, para
     no pisar lo guardado con una lista todavía vacía. */
  const [hidratadoPara, setHidratadoPara] = useState<string | null>(null)

  const pendientesRef = useRef(pendientes)
  const usuarioRef = useRef(usuarioId)
  const guardandoRef = useRef(false)
  const recargas = useRef(new Set<() => void>())
  /* Qué cambios hay escritos en el navegador ahora mismo (para no reescribirlos igual). */
  const escritoRef = useRef<string | null>(null)

  const total = pendientes.size
  const resumen = useMemo(() => resumir(pendientes), [pendientes])
  const totalRef = useRef(total)

  /* Los problemas que siguen vigentes (si la persona deshizo ese cambio, ya no cuenta). */
  const problemas = useMemo(() => problemasServidor.filter((p) => pendientes.has(clave(p.orden_id, p.etapa))), [problemasServidor, pendientes])
  const noAplicables = useMemo(() => [...noAplicablesSet].filter((k) => pendientes.has(k)).length, [noAplicablesSet, pendientes])
  const problemasRef = useRef(problemas)
  const noAplicablesRef = useRef(noAplicablesSet)

  /* Las funciones que se pasan a otros componentes (y la del bloqueador de
     navegación) leen siempre lo último a través de estos refs, que se ponen al día
     justo después de cada pintado. */
  useLayoutEffect(() => {
    pendientesRef.current = pendientes
    usuarioRef.current = usuarioId
    totalRef.current = total
    problemasRef.current = problemas
    noAplicablesRef.current = noAplicablesSet
  })

  /* ---------- Guardado en el navegador ---------- */
  useEffect(() => {
    if (!usuarioId) {
      // Sin sesión: se vacía la memoria, pero NO lo guardado (se recupera al volver a entrar).
      setPendientes(pendientesVacios)
      setProblemas([])
      setNoAplicables(new Set())
      setHidratadoPara(null)
      return
    }
    let recuperado: Pendientes | null = null
    try {
      const texto = window.localStorage.getItem(claveAlmacen(usuarioId))
      recuperado = deserializar(texto, usuarioId)
      if (texto && !recuperado) window.localStorage.removeItem(claveAlmacen(usuarioId)) // roto, de otra versión o caducado
    } catch {
      /* el navegador no deja leer el almacenamiento: se sigue sin recuperar nada */
    }
    // Siempre se reemplaza lo que había en memoria (podía ser de otro usuario).
    setPendientes(recuperado ?? pendientesVacios)
    setProblemas([])
    setNoAplicables(new Set())
    setRestaurados(recuperado?.size ?? 0)
    escritoRef.current = firmaDe(recuperado ?? pendientesVacios)
    setHidratadoPara(usuarioId)
  }, [usuarioId])

  useEffect(() => {
    if (!usuarioId || hidratadoPara !== usuarioId) return
    /* Solo se escribe cuando los cambios son otros: así recargar la página no renueva
       la caducidad de lo guardado (los 7 días cuentan desde el último cambio). */
    const firma = firmaDe(pendientes)
    if (firma === escritoRef.current) return
    try {
      if (pendientes.size === 0) window.localStorage.removeItem(claveAlmacen(usuarioId))
      else window.localStorage.setItem(claveAlmacen(usuarioId), serializar(usuarioId, pendientes))
      escritoRef.current = firma
    } catch {
      /* sin espacio o bloqueado: los cambios siguen en memoria */
    }
  }, [pendientes, usuarioId, hidratadoPara])

  /* ---------- Contador en el título de la pestaña ---------- */
  useEffect(() => {
    document.title = tituloConContador(document.title, total)
  }, [total])

  /* ---------- Aviso del navegador al recargar o cerrar ---------- */
  useEffect(() => {
    if (total === 0) return
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [total])

  /* ---------- Aviso al salir del módulo de producción ---------- */
  const bloqueador = useBlocker(
    ({ currentLocation, nextLocation }) =>
      totalRef.current > 0 && usuarioRef.current !== null && esRutaDeProduccion(currentLocation.pathname) && !esRutaDeProduccion(nextLocation.pathname),
  )

  /* ---------- Acciones ---------- */
  const marcar = useCallback((orden: OrdenFabricacion, etapa: Etapa, valor: boolean) => {
    const actual = pendientesRef.current
    const siguiente = marcarCambio(actual, orden, etapa, etapaMarcada(orden, etapa), valor)
    if (siguiente === actual && !actual.has(clave(orden.id, etapa))) {
      setAviso({ tipo: 'error', texto: `Hay demasiados cambios sin guardar (máximo ${MAX_CAMBIOS}). Guarda los actuales antes de seguir.` })
      return
    }
    setPendientes(siguiente)
    setAviso(null)
  }, [])

  const descartar = useCallback(() => {
    /* Se borra lo guardado en el navegador AHORA, sin esperar al efecto de escritura:
       si justo después se cierra la sesión, el usuario ya no existiría para borrarlo. */
    const uid = usuarioRef.current
    if (uid) {
      try {
        window.localStorage.removeItem(claveAlmacen(uid))
      } catch {
        /* el almacenamiento no está disponible: no hay nada que borrar */
      }
      escritoRef.current = firmaDe(pendientesVacios)
    }
    setPendientes(pendientesVacios)
    setProblemas([])
    setNoAplicables(new Set())
    setAviso(null)
    setRestaurados(0)
    setConfirmando(false)
  }, [])

  const descartarProblemas = useCallback(() => {
    const claves = [...problemasRef.current.map((p) => clave(p.orden_id, p.etapa)), ...noAplicablesRef.current]
    setPendientes((prev) => quitarClaves(prev, claves))
    setProblemas([])
    setNoAplicables(new Set())
  }, [])

  const avisarRecarga = useCallback(() => {
    for (const alRecargar of recargas.current) alRecargar()
  }, [])

  const guardar = useCallback(async () => {
    if (guardandoRef.current || pendientesRef.current.size === 0) return
    guardandoRef.current = true
    setGuardando(true)
    setAviso(null)
    try {
      const antes = pendientesRef.current
      const r = await guardarConReintentos(antes)
      // Lo que ya se resolvió sale de la lista; lo que la persona agregó mientras se guardaba, se conserva.
      const resueltas = r.estado === 'ok' ? [...antes.keys()] : [...antes.keys()].filter((k) => !r.pendientes.has(k))
      if (resueltas.length > 0) setPendientes((prev) => quitarClaves(prev, resueltas))
      setRestaurados(0)

      if (r.estado === 'ok') {
        setProblemas([])
        setAviso({
          tipo: 'ok',
          texto: r.guardados > 0 ? `Se ${r.guardados === 1 ? 'guardó' : 'guardaron'} ${plural(r.guardados, 'cambio', 'cambios')}.` : 'Listo: los cambios ya estaban guardados.',
        })
        avisarRecarga()
      } else if (r.estado === 'problemas') {
        setProblemas(r.problemas)
        if (r.yaEstaban > 0) avisarRecarga()
      } else {
        setProblemas([])
        setAviso({ tipo: 'error', texto: r.mensaje })
        if (r.yaEstaban > 0) avisarRecarga()
      }
    } finally {
      guardandoRef.current = false
      setGuardando(false)
    }
  }, [avisarRecarga])

  const conciliar = useCallback((ordenes: readonly OrdenFabricacion[]) => {
    const r = conciliarPendientes(pendientesRef.current, ordenes)
    if (r.descartados.length > 0) setPendientes((prev) => quitarClaves(prev, r.descartados))
    const ids = new Set(ordenes.map((o) => o.id))
    setNoAplicables((prev) => {
      const siguiente = sinClaves(prev, (k) => ids.has(k.split(':')[0]))
      r.noAplicables.forEach((k) => siguiente.add(k))
      return mismoConjunto(prev, siguiente) ? prev : siguiente
    })
  }, [])

  const suscribirRecarga = useCallback((alRecargar: () => void) => {
    recargas.current.add(alRecargar)
    return () => {
      recargas.current.delete(alRecargar)
    }
  }, [])

  const cerrarSesionSegura = useCallback(() => {
    if (totalRef.current > 0) setSaliendoDeSesion(true)
    else void cerrarSesion()
  }, [cerrarSesion])

  const valorEfectivo = useCallback((orden: OrdenFabricacion, etapa: Etapa) => valorConCambios(pendientes, orden, etapa), [pendientes])
  const ordenEfectiva = useCallback((orden: OrdenFabricacion) => ordenConCambios(pendientes, orden), [pendientes])
  const hayCambios = useCallback((ordenId: string) => ordenTieneCambios(pendientes, ordenId), [pendientes])
  const esPendiente = useCallback((ordenId: string, etapa: Etapa) => pendientes.has(clave(ordenId, etapa)), [pendientes])
  const esProblema = useCallback(
    (ordenId: string, etapa: Etapa) => {
      const k = clave(ordenId, etapa)
      return pendientes.has(k) && (noAplicablesSet.has(k) || problemasServidor.some((p) => clave(p.orden_id, p.etapa) === k))
    },
    [pendientes, noAplicablesSet, problemasServidor],
  )

  /* Si ya no queda nada pendiente mientras el aviso de salir estaba abierto, se deja pasar. */
  useEffect(() => {
    if (bloqueador.state === 'blocked' && total === 0) bloqueador.proceed()
  }, [bloqueador, total])
  useEffect(() => {
    if (confirmando && total === 0) setConfirmando(false)
    if (saliendoDeSesion && total === 0) setSaliendoDeSesion(false)
  }, [confirmando, saliendoDeSesion, total])

  const valor = useMemo<CambiosPendientesContexto>(
    () => ({
      pendientes,
      total,
      muebles: resumen.muebles,
      resumen,
      guardando,
      problemas,
      noAplicables,
      aviso,
      restaurados,
      valorEfectivo,
      ordenEfectiva,
      hayCambios,
      esPendiente,
      esProblema,
      marcar,
      descartar,
      descartarProblemas,
      guardar,
      conciliar,
      suscribirRecarga,
      confirmando,
      abrirConfirmacion: () => setConfirmando(true),
      cerrarConfirmacion: () => setConfirmando(false),
      cerrarAviso: () => setAviso(null),
      cerrarRestaurados: () => setRestaurados(0),
      cerrarSesionSegura,
    }),
    [
      pendientes,
      total,
      resumen,
      guardando,
      problemas,
      noAplicables,
      aviso,
      restaurados,
      valorEfectivo,
      ordenEfectiva,
      hayCambios,
      esPendiente,
      esProblema,
      marcar,
      descartar,
      descartarProblemas,
      guardar,
      conciliar,
      suscribirRecarga,
      confirmando,
      cerrarSesionSegura,
    ],
  )

  return (
    <Contexto.Provider value={valor}>
      {children}
      {confirmando && total > 0 && (
        <ConfirmarGuardado
          resumen={resumen}
          alCancelar={() => setConfirmando(false)}
          alConfirmar={() => {
            setConfirmando(false)
            void guardar()
          }}
        />
      )}
      {bloqueador.state === 'blocked' && total > 0 && (
        <AvisoSalida
          total={total}
          motivo="salir"
          alQuedarme={() => bloqueador.reset()}
          alSalir={() => {
            descartar()
            bloqueador.proceed()
          }}
        />
      )}
      {saliendoDeSesion && total > 0 && (
        <AvisoSalida
          total={total}
          motivo="cerrar-sesion"
          alQuedarme={() => setSaliendoDeSesion(false)}
          alSalir={() => {
            descartar()
            setSaliendoDeSesion(false)
            void cerrarSesion()
          }}
        />
      )}
    </Contexto.Provider>
  )
}

export function useCambiosPendientes() {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('useCambiosPendientes debe usarse dentro de <CambiosPendientesProvider>')
  return contexto
}
