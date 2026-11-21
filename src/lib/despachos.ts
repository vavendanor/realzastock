import type { OrdenFabricacion } from '../types'
import { inicioDelPlazo } from './diasHabiles'
import { compararPedido, direccionDeLista, esPiezaDeHoja } from './excelHoja'
import { traerTodo } from './hojas'
import { aplanarOrden, COLUMNAS_ORDEN, type OrdenRaw } from './ordenes'
import { supabase } from './supabaseClient'

/* Despachos: qué muebles esperan entrega, cómo se agrupan (por comuna, sin dirección, retiros en tienda) y
   cómo se ven por fecha. La parte que decide cosas es lógica pura, para probarla por separado. */

/* ---------------- Lógica pura ---------------- */

export type Destino = 'ruta' | 'sin_direccion' | 'retiro'

/* A dónde va un mueble: a una comuna (ruta), a ninguna dirección conocida, o a retirarse en la tienda. */
export function destinoDe(comuna: string | null): Destino {
  const d = direccionDeLista(comuna)
  return d === 'SIN DIRECCIÓN' ? 'sin_direccion' : d === 'RETIRO' ? 'retiro' : 'ruta'
}

/* Un mueble que ya salió o saldrá a despacho (en despacho o entregado), no cancelado. */
export const salenADespacho = (o: Pick<OrdenFabricacion, 'estado' | 'canceladoEn'>) =>
  o.canceladoEn === null && (o.estado === 'en_despacho' || o.estado === 'entregado')

/* Los muebles de un pedido que salen en su despacho (para el comprobante), por número. */
export const mueblesDeDespacho = (orden: OrdenFabricacion, hermanas: readonly OrdenFabricacion[]) =>
  [orden, ...hermanas].filter(salenADespacho).sort((a, b) => a.numero.localeCompare(b.numero, 'es', { numeric: true }))

/* Espera entrega: fabricado, no cancelado, y es un mueble o cojín (no unas patas o un ajuste). */
export const esDespachable = (o: Pick<OrdenFabricacion, 'estado' | 'canceladoEn' | 'esAdicional' | 'tipo'>) => o.estado === 'fabricado' && esPiezaDeHoja(o)

const unidadDe = (o: OrdenFabricacion) => Number(o.numero.split('-')[1]) || 0
const compararMueble = (a: OrdenFabricacion, b: OrdenFabricacion) => compararPedido(a.pedidoNumero, b.pedidoNumero) || unidadDe(a) - unidadDe(b)

export interface GrupoComuna {
  /* Comuna en minúsculas, para agrupar sin importar cómo vino escrita. */
  clave: string
  nombre: string
  muebles: OrdenFabricacion[]
}

export interface GrupoRegion {
  /* Nombre de la región; null si el mueble tiene comuna pero no se sabe su región. */
  nombre: string | null
  comunas: GrupoComuna[]
  /* Muebles de toda la región. */
  total: number
}

export interface GruposDeDestino {
  /* Las rutas: primero la región Metropolitana, después las demás en orden alfabético y, al final, lo que no tiene
     región. Dentro de cada región, las comunas en orden alfabético. */
  regiones: GrupoRegion[]
  sinDireccion: OrdenFabricacion[]
  /* Retiros en tienda: fuera de las rutas. */
  retiros: OrdenFabricacion[]
}

export const REGION_METROPOLITANA = 'Metropolitana de Santiago'

/* Desde cuándo corre el pedido: la fecha del pedido, o la del inicio del plazo si se cambió a mano. */
const antiguedadDe = (o: OrdenFabricacion) => inicioDelPlazo(o)

/* El más antiguo primero (por fecha del pedido o inicio del plazo); a igual fecha, por pedido y unidad. */
export const compararAntiguedad = (a: OrdenFabricacion, b: OrdenFabricacion) => {
  const x = antiguedadDe(a)
  const y = antiguedadDe(b)
  return x === y ? compararMueble(a, b) : x < y ? -1 : 1
}

const compararRegion = (a: string | null, b: string | null) => {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (a === REGION_METROPOLITANA) return -1
  if (b === REGION_METROPOLITANA) return 1
  return a.localeCompare(b, 'es')
}

/* Agrupa los muebles que esperan entrega: región, comuna y, dentro de la comuna, del pedido más antiguo al más nuevo.
   Sin dirección y retiros van aparte. Los que no son despachables se ignoran. */
export function agruparPorDestino(ordenes: readonly OrdenFabricacion[]): GruposDeDestino {
  const regiones = new Map<string, { nombre: string | null; comunas: Map<string, GrupoComuna> }>()
  const sinDireccion: OrdenFabricacion[] = []
  const retiros: OrdenFabricacion[] = []
  for (const o of ordenes.filter(esDespachable)) {
    const destino = destinoDe(o.comuna)
    if (destino === 'sin_direccion') sinDireccion.push(o)
    else if (destino === 'retiro') retiros.push(o)
    else {
      const nombreRegion = o.region?.trim() || null
      const region = regiones.get(nombreRegion ?? '') ?? { nombre: nombreRegion, comunas: new Map<string, GrupoComuna>() }
      const clave = (o.comuna ?? '').trim().toLowerCase()
      const comuna = region.comunas.get(clave) ?? { clave, nombre: (o.comuna ?? '').trim(), muebles: [] }
      comuna.muebles.push(o)
      region.comunas.set(clave, comuna)
      regiones.set(nombreRegion ?? '', region)
    }
  }
  return {
    regiones: [...regiones.values()]
      .sort((a, b) => compararRegion(a.nombre, b.nombre))
      .map((r) => {
        const comunas = [...r.comunas.values()]
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
          .map((c) => ({ ...c, muebles: c.muebles.sort(compararAntiguedad) }))
        return { nombre: r.nombre, comunas, total: comunas.reduce((s, c) => s + c.muebles.length, 0) }
      }),
    sinDireccion: sinDireccion.sort(compararMueble),
    retiros: retiros.sort(compararMueble),
  }
}

/* ---------------- Para paginar: la lista plana y los bloques de cada página ---------------- */

export type Seccion = 'ruta' | 'sin_direccion' | 'retiro'

/* Un mueble en el orden en que se muestra, sabiendo a qué grupo (comuna, sin dirección o retiro) pertenece. */
export interface FilaDeLista {
  mueble: OrdenFabricacion
  seccion: Seccion
  region: string | null
  /* Título del grupo: la comuna, "Sin dirección" o "Retiro en tienda". */
  titulo: string
  claveGrupo: string
  /* Posición dentro de su grupo (desde 0) y tamaño del grupo completo, esté en la página que esté. */
  indice: number
  totalGrupo: number
}

export const TITULO_SIN_DIRECCION = 'Sin dirección'
export const TITULO_RETIRO = 'Retiro en tienda'

/* Todos los muebles en el orden de pantalla: regiones y comunas, luego "Sin dirección" y al final los retiros. */
export function aplanarDespachos(g: GruposDeDestino): FilaDeLista[] {
  const filas: FilaDeLista[] = []
  const agregar = (muebles: readonly OrdenFabricacion[], seccion: Seccion, region: string | null, titulo: string, claveGrupo: string) =>
    muebles.forEach((mueble, indice) => filas.push({ mueble, seccion, region, titulo, claveGrupo, indice, totalGrupo: muebles.length }))
  for (const r of g.regiones) for (const c of r.comunas) agregar(c.muebles, 'ruta', r.nombre, c.nombre, `ruta|${r.nombre ?? ''}|${c.clave}`)
  agregar(g.sinDireccion, 'sin_direccion', null, TITULO_SIN_DIRECCION, 'sin_direccion')
  agregar(g.retiros, 'retiro', null, TITULO_RETIRO, 'retiro')
  return filas
}

/* Lo que se dibuja en una página: los muebles seguidos de un mismo grupo forman un bloque. Si el grupo empezó en la
   página anterior, el bloque lo dice (`continua`) para repetir su encabezado; si sigue en la siguiente, también
   (`sigue`). `nuevaRegion` marca el primer bloque de cada región en la página, para poner su encabezado. */
export interface BloqueDePagina {
  claveGrupo: string
  seccion: Seccion
  region: string | null
  titulo: string
  muebles: OrdenFabricacion[]
  totalGrupo: number
  continua: boolean
  sigue: boolean
  nuevaRegion: boolean
}

export function bloquesDeFilas(filas: readonly FilaDeLista[]): BloqueDePagina[] {
  const bloques: BloqueDePagina[] = []
  for (const f of filas) {
    const ultimo = bloques[bloques.length - 1]
    if (ultimo && ultimo.claveGrupo === f.claveGrupo) {
      ultimo.muebles.push(f.mueble)
      ultimo.sigue = f.indice < f.totalGrupo - 1
      continue
    }
    bloques.push({
      claveGrupo: f.claveGrupo,
      seccion: f.seccion,
      region: f.region,
      titulo: f.titulo,
      muebles: [f.mueble],
      totalGrupo: f.totalGrupo,
      continua: f.indice > 0,
      sigue: f.indice < f.totalGrupo - 1,
      nuevaRegion: f.seccion === 'ruta' && (!ultimo || ultimo.seccion !== 'ruta' || ultimo.region !== f.region),
    })
  }
  return bloques
}

export interface GrupoFecha {
  fecha: string
  /* Programados y todavía fabricados: se pueden quitar de la fecha o marcar despachados. */
  porSalir: OrdenFabricacion[]
  /* Ya marcados despachados con esa fecha. */
  salidos: OrdenFabricacion[]
}

const compararEnRuta = (a: OrdenFabricacion, b: OrdenFabricacion) =>
  (a.comuna ?? '').localeCompare(b.comuna ?? '', 'es') || compararMueble(a, b)

/* Los muebles con fecha, agrupados por día (el más próximo primero). Los cancelados no aparecen. */
export function agruparPorFecha(ordenes: readonly OrdenFabricacion[]): GrupoFecha[] {
  const dias = new Map<string, GrupoFecha>()
  for (const o of ordenes) {
    if (!o.despachoProgramado || !esPiezaDeHoja(o)) continue
    if (o.estado !== 'fabricado' && o.estado !== 'en_despacho') continue
    const g = dias.get(o.despachoProgramado) ?? { fecha: o.despachoProgramado, porSalir: [], salidos: [] }
    ;(o.estado === 'fabricado' ? g.porSalir : g.salidos).push(o)
    dias.set(o.despachoProgramado, g)
  }
  return [...dias.values()]
    .sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
    .map((g) => ({ ...g, porSalir: g.porSalir.sort(compararEnRuta), salidos: g.salidos.sort(compararEnRuta) }))
}

export interface PartesDePedido {
  /* Muebles del pedido (sin cancelados ni adicionales). */
  muebles: number
  /* Cuántos ya no están por fabricar y cuántos ya salieron a despacho. */
  listos: number
  salieron: number
}

/* Cuántos muebles tiene cada pedido y en qué punto está cada uno: para avisar de los despachos parciales. */
export function partesDePedidos(ordenes: readonly OrdenFabricacion[]): Map<string, PartesDePedido> {
  const partes = new Map<string, PartesDePedido>()
  for (const o of ordenes.filter(esPiezaDeHoja)) {
    const p = partes.get(o.pedidoNumero) ?? { muebles: 0, listos: 0, salieron: 0 }
    p.muebles++
    if (o.estado !== 'por_fabricar') p.listos++
    if (o.estado === 'en_despacho' || o.estado === 'entregado') p.salieron++
    partes.set(o.pedidoNumero, p)
  }
  return partes
}

/* "Faltan 1 por fabricar" o "1 de 2 ya salieron"; null si el pedido es de un solo mueble o va completo y junto. */
export function textoDePartes(p: PartesDePedido | undefined) {
  if (!p || p.muebles < 2) return null
  if (p.listos < p.muebles) return `Pedido en partes: ${p.muebles - p.listos} por fabricar`
  if (p.salieron > 0 && p.salieron < p.muebles) return `Pedido en partes: ${p.salieron} de ${p.muebles} ya salieron`
  return null
}

/* "2026-11-17" -> "Lunes 17-11-2026" (sin pasar por la zona horaria del dispositivo). */
export function etiquetaDeFecha(fecha: string) {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const nombre = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(Date.UTC(anio, mes - 1, dia, 12)).getUTCDay()]
  return `${nombre[0].toUpperCase()}${nombre.slice(1)} ${String(dia).padStart(2, '0')}-${String(mes).padStart(2, '0')}-${anio}`
}

/* ---------------- Acceso a la base de datos ---------------- */

/* La columna despacho_programado no está en la vista de las hojas, así que no va en COLUMNAS_ORDEN. */
const COLUMNAS_DESPACHO = `${COLUMNAS_ORDEN},despacho_programado`
type Pedido = PromiseLike<{ data: OrdenRaw[] | null; error: { message: string } | null }>

/* Los muebles fabricados (esperan entrega) y los que salieron con fecha de ese día en adelante. */
export async function listarMueblesDeDespachos(desdeFecha: string): Promise<OrdenFabricacion[]> {
  const [fabricados, salidos] = await Promise.all([
    traerTodo<OrdenRaw>(
      (d, h) =>
        supabase.from('ordenes_fabricacion').select(COLUMNAS_DESPACHO).eq('estado', 'fabricado').is('cancelado_en', null).order('id').range(d, h) as unknown as Pedido,
    ),
    traerTodo<OrdenRaw>(
      (d, h) =>
        supabase
          .from('ordenes_fabricacion')
          .select(COLUMNAS_DESPACHO)
          .eq('estado', 'en_despacho')
          .is('cancelado_en', null)
          .gte('despacho_programado', desdeFecha)
          .order('id')
          .range(d, h) as unknown as Pedido,
    ),
  ])
  return [...fabricados, ...salidos].map(aplanarOrden)
}

/* Todos los muebles (no cancelados) de esos pedidos: para saber cuáles salen en partes. */
export async function listarMueblesDePedidos(pedidos: readonly string[]): Promise<OrdenFabricacion[]> {
  const todos: OrdenFabricacion[] = []
  for (let i = 0; i < pedidos.length; i += 100) {
    const { data, error } = await supabase
      .from('ordenes_fabricacion')
      .select(COLUMNAS_ORDEN)
      .in('pedido_numero', pedidos.slice(i, i + 100))
      .is('cancelado_en', null)
    if (error) throw new Error(error.message)
    todos.push(...((data ?? []) as unknown as OrdenRaw[]).map(aplanarOrden))
  }
  return todos
}

async function llamar(funcion: string, args: Record<string, unknown>): Promise<number> {
  const { data, error } = await supabase.rpc(funcion, args)
  if (error) throw new Error(error.message)
  return data as number
}

/* "AAAA-MM-DD". Todo o nada: si algún mueble no sirve, el error lo nombra y no se programa ninguno. */
export const programarDespacho = (ordenIds: readonly string[], fecha: string) => llamar('programar_despacho', { p_orden_ids: [...ordenIds], p_fecha: fecha })
export const quitarDespachoProgramado = (ordenIds: readonly string[]) => llamar('quitar_despacho_programado', { p_orden_ids: [...ordenIds] })
/* Pasa los muebles de "fabricado" a "en despacho" y guarda cuándo salieron. */
export const marcarDespachado = (ordenIds: readonly string[]) => llamar('marcar_despachado', { p_orden_ids: [...ordenIds] })
