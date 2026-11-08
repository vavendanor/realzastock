import type { EstadoOrden, Etapa, OrdenFabricacion } from '../types'
import { aplicarEtapaLocal, etapaMarcada, etapasBloqueadas } from './ordenes'

/* Cambios de casillas (B, I, A, C y LISTO) que todavía NO se guardaron. Todo en
   este archivo es lógica pura (sin React, sin red, sin navegador) para poder
   probarla por separado. El almacén que la usa está en
   hooks/useCambiosPendientes.tsx, y el envío al servidor en guardarCambios.ts.

   Un cambio pendiente recuerda dos cosas:
     * valor: cómo debe quedar la casilla.
     * esperado: cómo estaba cuando la persona la vio. Se envía al servidor, que
       lo compara con el valor actual (doble verificación). */

export const ETAPAS_ID: readonly Etapa[] = ['b', 'i', 'a', 'c', 'listo']
export const ETAPA_NOMBRE: Record<Etapa, string> = { b: 'B', i: 'I', a: 'A', c: 'C', listo: 'LISTO' }

/* El servidor acepta hasta 500 cambios por lote (guardar_cambios_etapas). */
export const MAX_CAMBIOS = 500

/* Los cambios guardados en el navegador caducan a los 7 días. */
export const CADUCIDAD_MS = 7 * 24 * 60 * 60 * 1000

export interface CambioPendiente {
  ordenId: string
  /* "1180-2": solo para mostrarlo en los resúmenes y avisos. */
  numero: string
  etapa: Etapa
  valor: boolean
  esperado: boolean
}

export type Pendientes = ReadonlyMap<string, CambioPendiente>

export const clave = (ordenId: string, etapa: Etapa) => `${ordenId}:${etapa}`
export const pendientesVacios: Pendientes = new Map()

/* ---------------- Marcar y desmarcar ---------------- */

/* Marca o desmarca una casilla. `valorServidor` es lo que muestra el servidor
   AHORA para esa casilla. Si el cambio devuelve la casilla a como estaba cuando
   se tocó por primera vez, deja de ser un cambio: se anula. Si ya hay 500
   cambios, no agrega otro (devuelve el mismo mapa). */
export function marcarCambio(
  pendientes: Pendientes,
  orden: { id: string; numero: string },
  etapa: Etapa,
  valorServidor: boolean,
  nuevoValor: boolean,
): Pendientes {
  const k = clave(orden.id, etapa)
  const previo = pendientes.get(k)
  const base = previo ? previo.esperado : valorServidor
  const siguiente = new Map(pendientes)
  if (nuevoValor === base) {
    siguiente.delete(k)
  } else {
    if (!previo && pendientes.size >= MAX_CAMBIOS) return pendientes
    siguiente.set(k, { ordenId: orden.id, numero: orden.numero, etapa, valor: nuevoValor, esperado: base })
  }
  return siguiente
}

export const puedeAgregar = (pendientes: Pendientes, ordenId: string, etapa: Etapa) =>
  pendientes.has(clave(ordenId, etapa)) || pendientes.size < MAX_CAMBIOS

/* El valor que debe MOSTRAR la casilla: el pendiente si lo hay, si no el del servidor. */
export function valorEfectivo(pendientes: Pendientes, orden: OrdenFabricacion, etapa: Etapa) {
  return pendientes.get(clave(orden.id, etapa))?.valor ?? etapaMarcada(orden, etapa)
}

export const cambiosDeOrden = (pendientes: Pendientes, ordenId: string) => [...pendientes.values()].filter((c) => c.ordenId === ordenId)
export const ordenTieneCambios = (pendientes: Pendientes, ordenId: string) => cambiosDeOrden(pendientes, ordenId).length > 0

/* La orden tal como quedaría con los cambios pendientes aplicados (estado incluido:
   marcar LISTO la pasa a "fabricado"). Solo para mostrarla; no cambia nada. */
export function ordenEfectiva(pendientes: Pendientes, orden: OrdenFabricacion): OrdenFabricacion {
  let o = orden
  for (const c of cambiosDeOrden(pendientes, orden.id)) o = aplicarEtapaLocal(o, c.etapa, c.valor)
  return o
}

export function quitarClaves(pendientes: Pendientes, claves: Iterable<string>): Pendientes {
  const siguiente = new Map(pendientes)
  for (const k of claves) siguiente.delete(k)
  return siguiente
}

/* ---------------- Resumen para la confirmación ---------------- */

export interface EntradaResumen {
  ordenId: string
  numero: string
  cambios: { etapa: Etapa; etiqueta: string; valor: boolean }[]
  /* Si el cambio incluye LISTO, el estado de la orden cambia. */
  cambioDeEstado: { de: EstadoOrden; a: EstadoOrden } | null
}

export interface Resumen {
  total: number
  muebles: number
  entradas: EntradaResumen[]
}

const porNumero = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true })

export function resumir(pendientes: Pendientes): Resumen {
  const porOrden = new Map<string, CambioPendiente[]>()
  for (const c of pendientes.values()) porOrden.set(c.ordenId, [...(porOrden.get(c.ordenId) ?? []), c])
  const entradas: EntradaResumen[] = [...porOrden.entries()]
    .map(([ordenId, cambios]) => {
      const ordenados = [...cambios].sort((a, b) => ETAPAS_ID.indexOf(a.etapa) - ETAPAS_ID.indexOf(b.etapa))
      const listo = ordenados.find((c) => c.etapa === 'listo')
      return {
        ordenId,
        numero: ordenados[0].numero,
        cambios: ordenados.map((c) => ({ etapa: c.etapa, etiqueta: ETAPA_NOMBRE[c.etapa], valor: c.valor })),
        cambioDeEstado: listo
          ? listo.valor
            ? { de: 'por_fabricar' as const, a: 'fabricado' as const }
            : { de: 'fabricado' as const, a: 'por_fabricar' as const }
          : null,
      }
    })
    .sort((a, b) => porNumero(a.numero, b.numero))
  return { total: pendientes.size, muebles: entradas.length, entradas }
}

export const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/* "7 cambios sin guardar en 4 muebles". */
export function textoBarra(total: number, muebles: number) {
  return `${plural(total, 'cambio', 'cambios')} sin guardar en ${plural(muebles, 'mueble', 'muebles')}`
}

/* "(7) Pedidos": el contador que se antepone al título de la pestaña. */
export function tituloConContador(base: string, total: number) {
  const limpio = base.replace(/^\(\d+\)\s*/, '')
  return total > 0 ? `(${total}) ${limpio}` : limpio
}

/* ---------------- Lote para el servidor ---------------- */

export interface CambioDeLote {
  orden_id: string
  etapa: Etapa
  valor: boolean
  esperado: boolean
}

export function aLote(pendientes: Pendientes): CambioDeLote[] {
  return [...pendientes.values()]
    .sort((a, b) => porNumero(a.numero, b.numero) || ETAPAS_ID.indexOf(a.etapa) - ETAPAS_ID.indexOf(b.etapa))
    .map((c) => ({ orden_id: c.ordenId, etapa: c.etapa, valor: c.valor, esperado: c.esperado }))
}

/* ---------------- Lo que responde el servidor ---------------- */

export type MotivoProblema = 'conflicto' | 'cancelada' | 'bloqueada' | 'no_existe'

/* Un elemento del DETAIL del error de guardar_cambios_etapas. */
export interface ProblemaServidor {
  orden_id: string
  numero: string | null
  etapa: Etapa
  motivo: MotivoProblema
  /* Valor actual de la casilla en el servidor (null si la orden no existe). */
  actual: boolean | null
}

export interface ProblemaConPendiente extends ProblemaServidor {
  pendiente: CambioPendiente
  mensaje: string
}

export type RespuestaError =
  | { tipo: 'problemas'; problemas: ProblemaServidor[] }
  | { tipo: 'otro'; mensaje: string; codigo: string | null }

const MOTIVOS: readonly string[] = ['conflicto', 'cancelada', 'bloqueada', 'no_existe']

function esProblema(x: unknown): x is ProblemaServidor {
  if (typeof x !== 'object' || x === null) return false
  const p = x as Record<string, unknown>
  return (
    typeof p.orden_id === 'string' &&
    (p.numero === null || typeof p.numero === 'string') &&
    typeof p.etapa === 'string' &&
    ETAPAS_ID.includes(p.etapa as Etapa) &&
    typeof p.motivo === 'string' &&
    MOTIVOS.includes(p.motivo) &&
    (p.actual === null || typeof p.actual === 'boolean')
  )
}

/* Interpreta el error de supabase-js (message, details, code). Los cambios que no
   se pueden aplicar llegan como JSON en `details`. */
export function interpretarError(error: { message?: string; details?: string | null; code?: string | null } | unknown): RespuestaError {
  const e = (typeof error === 'object' && error !== null ? error : {}) as { message?: string; details?: string | null; code?: string | null }
  const codigo = e.code ?? null
  if (codigo === 'P0001' && typeof e.details === 'string' && e.details.trim()) {
    try {
      const lista: unknown = JSON.parse(e.details)
      if (Array.isArray(lista) && lista.length > 0 && lista.every(esProblema)) return { tipo: 'problemas', problemas: lista }
    } catch {
      /* el detalle no era JSON: se trata como un error cualquiera */
    }
  }
  if (codigo === 'PGRST202' || /Could not find the function|does not exist/i.test(e.message ?? '')) {
    return { tipo: 'otro', codigo, mensaje: 'Falta aplicar la migración 0017 en la base de datos: la función para guardar los cambios no existe.' }
  }
  if (codigo === '42501') return { tipo: 'otro', codigo, mensaje: 'No tienes permiso para guardar estos cambios.' }
  return { tipo: 'otro', codigo, mensaje: e.message?.trim() || 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.' }
}

export function mensajeProblema(p: Pick<ProblemaServidor, 'motivo' | 'numero' | 'etapa'>) {
  const casilla = `${p.numero ?? 'La orden'} · ${ETAPA_NOMBRE[p.etapa]}`
  switch (p.motivo) {
    case 'cancelada':
      return `${casilla}: el pedido fue cancelado en Shopify.`
    case 'bloqueada':
      return `${casilla}: el mueble ya salió a despacho o fue entregado, y sus etapas no se pueden cambiar.`
    case 'no_existe':
      return `${casilla}: la orden ya no existe.`
    case 'conflicto':
      return `${casilla}: otra persona la cambió mientras tanto.`
  }
}

/* Separa los problemas que el servidor reportó en dos grupos:
     * resueltos: el valor ACTUAL ya es el que la persona quería (otra persona, o la
       sincronización con Shopify, ya lo dejó así). No hay nada que hacer ni que
       avisar: el cambio se da por hecho.
     * reales: el valor actual NO es el pedido (la orden está en despacho, cancelada
       o ya no existe).
   Con casillas de sí/no, un "conflicto" siempre es de los resueltos: si el
   valor actual no es el esperado, es el pedido. */
export function clasificarProblemas(pendientes: Pendientes, problemas: ProblemaServidor[]) {
  const resueltos: string[] = []
  const reales: ProblemaConPendiente[] = []
  for (const p of problemas) {
    const k = clave(p.orden_id, p.etapa)
    const pendiente = pendientes.get(k)
    if (!pendiente) continue
    if (p.actual !== null && p.actual === pendiente.valor) resueltos.push(k)
    else reales.push({ ...p, pendiente, mensaje: mensajeProblema(p) })
  }
  return { resueltos, reales }
}

/* ---------------- Poner al día contra lo que trae el servidor ---------------- */

export interface ResultadoConciliacion {
  pendientes: Pendientes
  /* Cambios que ya no hacen falta porque el servidor ya trae ese valor. */
  descartados: string[]
  /* Cambios cuya orden ya no admite cambios (en despacho, entregada o cancelada). */
  noAplicables: ReadonlySet<string>
}

/* Se llama cada vez que una pantalla carga órdenes. Quita los pendientes que el
   servidor ya cumplió (por ejemplo, la sincronización marcó "fabricado" desde
   Shopify) y marca los que ya no se podrían guardar. */
export function conciliar(pendientes: Pendientes, ordenes: readonly OrdenFabricacion[]): ResultadoConciliacion {
  const porId = new Map(ordenes.map((o) => [o.id, o]))
  const descartados: string[] = []
  const noAplicables = new Set<string>()
  for (const [k, c] of pendientes) {
    const o = porId.get(c.ordenId)
    if (!o) continue
    if (etapaMarcada(o, c.etapa) === c.valor) descartados.push(k)
    else if (etapasBloqueadas(o)) noAplicables.add(k)
  }
  return { pendientes: descartados.length ? quitarClaves(pendientes, descartados) : pendientes, descartados, noAplicables }
}

/* ---------------- Guardado en el navegador ---------------- */

export const claveAlmacen = (usuarioId: string) => `rh:pendientes:v1:${usuarioId}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function serializar(usuarioId: string, pendientes: Pendientes, ahora: Date = new Date()) {
  return JSON.stringify({ v: 1, usuario: usuarioId, guardadoEn: ahora.toISOString(), cambios: [...pendientes.values()] })
}

/* Lee lo guardado. Devuelve null si no sirve: texto roto, versión distinta, de
   otro usuario, caducado (más de 7 días) o sin ningún cambio válido. Los cambios
   sueltos que estén mal formados se ignoran, sin descartar el resto. */
export function deserializar(texto: string | null, usuarioId: string, ahora: Date = new Date()): Pendientes | null {
  if (!texto) return null
  let datos: unknown
  try {
    datos = JSON.parse(texto)
  } catch {
    return null
  }
  if (typeof datos !== 'object' || datos === null) return null
  const d = datos as Record<string, unknown>
  if (d.v !== 1 || d.usuario !== usuarioId || typeof d.guardadoEn !== 'string' || !Array.isArray(d.cambios)) return null
  const guardadoEn = Date.parse(d.guardadoEn)
  if (Number.isNaN(guardadoEn)) return null
  const edad = ahora.getTime() - guardadoEn
  if (edad > CADUCIDAD_MS || edad < -24 * 60 * 60 * 1000) return null

  const resultado = new Map<string, CambioPendiente>()
  for (const x of d.cambios) {
    if (resultado.size >= MAX_CAMBIOS) break
    if (typeof x !== 'object' || x === null) continue
    const c = x as Record<string, unknown>
    if (
      typeof c.ordenId !== 'string' ||
      !UUID.test(c.ordenId) ||
      typeof c.numero !== 'string' ||
      c.numero.length === 0 ||
      c.numero.length > 40 ||
      typeof c.etapa !== 'string' ||
      !ETAPAS_ID.includes(c.etapa as Etapa) ||
      typeof c.valor !== 'boolean' ||
      typeof c.esperado !== 'boolean' ||
      c.valor === c.esperado
    ) {
      continue
    }
    resultado.set(clave(c.ordenId, c.etapa as Etapa), { ordenId: c.ordenId, numero: c.numero, etapa: c.etapa as Etapa, valor: c.valor, esperado: c.esperado })
  }
  return resultado.size > 0 ? resultado : null
}
