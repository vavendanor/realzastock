import { calcularPlazo, hoyEnChile, inicioDelPlazo, type Calendario } from './diasHabiles'
import { leerCalendario } from './feriados'
import { supabase } from './supabaseClient'

/* Hojas de fabricación: listas con nombre de PEDIDOS que el taller fabrica junto.
   La hoja guarda solo qué pedidos incluye; los datos de cada pieza se leen siempre
   en vivo de ordenes_fabricacion (vista hoja_fabricacion_piezas, migración 0017).

   Este archivo reúne lo que necesitan las pantallas /hojas y /hojas/nueva. La parte
   que decide cosas (nombre sugerido, validaciones, qué cuenta como pieza, cómo se
   arma cada tarjeta) es lógica pura, para probarla por separado. */

/* Los mismos topes que impone la base de datos (crear_hoja_fabricacion). */
export const MAX_PEDIDOS_POR_HOJA = 300
export const MAX_NOMBRE_HOJA = 80

/* ---------------- Lógica pura ---------------- */

/* "2026-11-08" -> "Hoja 08-11-2026". */
export function nombreSugerido(fecha: string) {
  const [anio, mes, dia] = fecha.split('-')
  return `Hoja ${dia}-${mes}-${anio}`
}

/* Mensaje de error si el nombre no sirve (mismas reglas que la base de datos), o null. */
export function errorDeNombre(nombre: string) {
  const largo = nombre.trim().length
  if (largo === 0) return 'Escribe un nombre para la hoja.'
  if (largo > MAX_NOMBRE_HOJA) return `El nombre puede tener hasta ${MAX_NOMBRE_HOJA} caracteres (tiene ${largo}).`
  return null
}

/* Lo que la persona escribe en "Agregar pedido por N°": "1280", " #1280 ". null si no sirve. */
export function normalizarNumeroPedido(texto: string) {
  const limpio = texto.trim().replace(/^#/, '').trim()
  return /^[0-9A-Za-z]{1,20}$/.test(limpio) ? limpio : null
}

/* Qué cuenta como "pieza" en las listas: los muebles y los cojines; no las patas
   extra ni los ajustes de medida. Es la misma regla de la vista de la base de datos
   (es_pieza_fabricable). */
export const esPiezaFabricable = (o: { esAdicional: boolean; tipo: string | null }) => !o.esAdicional || o.tipo === 'COJÍN'

export interface ResumenPedido {
  pedidoNumero: string
  fechaPedido: string
  /* Piezas del pedido que cuentan (sin canceladas). */
  piezas: number
  /* Cuántas de ellas siguen por fabricar. */
  porFabricar: number
  /* "SOFÁ OSORNO", "POLTRONA OSORNO"... */
  modelos: string[]
}

export interface FilaDePedido {
  pedido_numero: string
  fecha_pedido: string
  tipo: string | null
  modelo: string | null
  estado: string
  es_adicional: boolean
  cancelado_en: string | null
}

/* Resume un pedido a partir de sus órdenes. null si no tiene ninguna activa (no existe o
   está todo cancelado): esos pedidos no se pueden agregar a una hoja. */
export function resumirPedido(filas: readonly FilaDePedido[]): ResumenPedido | null {
  const activas = filas.filter((f) => f.cancelado_en === null)
  if (activas.length === 0) return null
  const piezas = activas.filter((f) => esPiezaFabricable({ esAdicional: f.es_adicional, tipo: f.tipo }))
  const modelos = [...new Set(piezas.map((f) => [f.tipo, f.modelo].filter(Boolean).join(' ')).filter(Boolean))]
  return {
    pedidoNumero: activas[0].pedido_numero,
    fechaPedido: activas.reduce((a, f) => (f.fecha_pedido < a ? f.fecha_pedido : a), activas[0].fecha_pedido),
    piezas: piezas.length,
    porFabricar: piezas.filter((f) => f.estado === 'por_fabricar').length,
    modelos,
  }
}

export interface HojaGuardada {
  id: string
  nombre: string
  creada_en: string
}

export interface PiezaDeHoja {
  hoja_id: string
  estado: string
  es_pieza_fabricable: boolean
  cancelado_en: string | null
  fecha_pedido: string
  plazo_desde: string | null
}

export interface TarjetaHoja {
  id: string
  nombre: string
  creadaEn: string
  pedidos: number
  /* Piezas que cuentan (sin canceladas) y cuántas siguen por fabricar. */
  piezas: number
  pendientes: number
  /* De 0 a 1: la parte de las piezas que ya no está por fabricar. */
  avance: number
  /* Días hábiles de retraso de la pieza pendiente más atrasada (0 si ninguna se pasó del plazo). */
  retrasoMaximo: number
  /* El calendario de feriados no cubre el año de algún cálculo: el retraso puede estar mal. */
  sinCalendario: boolean
}

/* Arma las tarjetas de /hojas. `pedidosPorHoja`: cuántos pedidos tiene cada hoja (sale de
   hoja_fabricacion_pedidos: cuenta también los pedidos que hoy no tienen piezas activas). */
export function construirTarjetas(
  hojas: readonly HojaGuardada[],
  pedidosPorHoja: ReadonlyMap<string, number>,
  piezas: readonly PiezaDeHoja[],
  calendario: Calendario,
  hoy: string,
): TarjetaHoja[] {
  const porHoja = new Map<string, PiezaDeHoja[]>()
  for (const p of piezas) porHoja.set(p.hoja_id, [...(porHoja.get(p.hoja_id) ?? []), p])
  const plazos = new Map<string, ReturnType<typeof calcularPlazo>>()
  const plazoDe = (inicio: string) => {
    let r = plazos.get(inicio)
    if (!r) {
      r = calcularPlazo(inicio, hoy, calendario)
      plazos.set(inicio, r)
    }
    return r
  }

  return [...hojas]
    .sort((a, b) => (a.creada_en < b.creada_en ? 1 : a.creada_en > b.creada_en ? -1 : a.nombre.localeCompare(b.nombre, 'es')))
    .map((h) => {
      const cuentan = (porHoja.get(h.id) ?? []).filter((p) => p.es_pieza_fabricable && p.cancelado_en === null)
      const pendientes = cuentan.filter((p) => p.estado === 'por_fabricar')
      let retrasoMaximo = 0
      let sinCalendario = false
      for (const p of pendientes) {
        const r = plazoDe(inicioDelPlazo({ fechaPedido: p.fecha_pedido, plazoDesde: p.plazo_desde }))
        retrasoMaximo = Math.max(retrasoMaximo, r.retraso)
        sinCalendario ||= r.sinCalendario
      }
      return {
        id: h.id,
        nombre: h.nombre,
        creadaEn: h.creada_en,
        pedidos: pedidosPorHoja.get(h.id) ?? 0,
        piezas: cuentan.length,
        pendientes: pendientes.length,
        avance: cuentan.length > 0 ? (cuentan.length - pendientes.length) / cuentan.length : 0,
        retrasoMaximo,
        sinCalendario,
      }
    })
}

/* ---------------- Acceso a la base de datos ---------------- */

const PAGINA = 1000

/* Trae todas las filas de una consulta, de a 1000 (el máximo que entrega la API). */
async function traerTodo<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const filas: T[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await pedir(desde, desde + PAGINA - 1)
    if (error) throw new Error(error.message)
    const lote = data ?? []
    filas.push(...lote)
    if (lote.length < PAGINA) return filas
  }
}

export async function listarTarjetasHojas(): Promise<{ tarjetas: TarjetaHoja[]; sinCalendario: boolean }> {
  const [hojasRes, calendario] = await Promise.all([
    supabase.from('hojas_fabricacion').select('id,nombre,creada_en').order('creada_en', { ascending: false }),
    leerCalendario(),
  ])
  if (hojasRes.error) throw new Error(hojasRes.error.message)
  const hojas = (hojasRes.data ?? []) as HojaGuardada[]
  if (hojas.length === 0) return { tarjetas: [], sinCalendario: false }

  const [filasPedidos, piezas] = await Promise.all([
    traerTodo<{ hoja_id: string }>((d, h) =>
      supabase.from('hoja_fabricacion_pedidos').select('hoja_id').order('hoja_id').order('shopify_order_id').range(d, h),
    ),
    traerTodo<PiezaDeHoja>((d, h) =>
      supabase
        .from('hoja_fabricacion_piezas')
        .select('hoja_id,estado,es_pieza_fabricable,cancelado_en,fecha_pedido,plazo_desde')
        .order('hoja_id')
        .order('id')
        .range(d, h),
    ),
  ])
  const pedidosPorHoja = new Map<string, number>()
  for (const f of filasPedidos) pedidosPorHoja.set(f.hoja_id, (pedidosPorHoja.get(f.hoja_id) ?? 0) + 1)

  const tarjetas = construirTarjetas(hojas, pedidosPorHoja, piezas, calendario, hoyEnChile())
  return { tarjetas, sinCalendario: tarjetas.some((t) => t.sinCalendario) }
}

/* Busca un pedido por su número y lo resume. null si no existe o está todo cancelado. */
export async function obtenerResumenPedido(numero: string): Promise<ResumenPedido | null> {
  const { data, error } = await supabase
    .from('ordenes_fabricacion')
    .select('pedido_numero,fecha_pedido,tipo,modelo,estado,es_adicional,cancelado_en')
    .eq('pedido_numero', numero)
  if (error) throw new Error(error.message)
  return resumirPedido((data ?? []) as FilaDePedido[])
}

/* Resume varios pedidos de una vez (el panel de la hoja en preparación). Los que no existen o
   están todos cancelados no aparecen en el resultado. */
export async function obtenerResumenesPedidos(numeros: readonly string[]): Promise<Map<string, ResumenPedido>> {
  const resumenes = new Map<string, ResumenPedido>()
  for (let i = 0; i < numeros.length; i += 100) {
    const { data, error } = await supabase
      .from('ordenes_fabricacion')
      .select('pedido_numero,fecha_pedido,tipo,modelo,estado,es_adicional,cancelado_en')
      .in('pedido_numero', numeros.slice(i, i + 100))
    if (error) throw new Error(error.message)
    const porPedido = new Map<string, FilaDePedido[]>()
    for (const f of (data ?? []) as FilaDePedido[]) porPedido.set(f.pedido_numero, [...(porPedido.get(f.pedido_numero) ?? []), f])
    for (const [numero, filas] of porPedido) {
      const r = resumirPedido(filas)
      if (r) resumenes.set(numero, r)
    }
  }
  return resumenes
}

/* Nombres de las hojas en las que ya está un pedido (para avisarlo: está permitido que esté en varias). */
export async function hojasDelPedido(numero: string): Promise<string[]> {
  const { data, error } = await supabase.from('hoja_fabricacion_pedidos').select('hoja_id').eq('pedido_numero', numero)
  if (error) throw new Error(error.message)
  const ids = [...new Set(((data ?? []) as { hoja_id: string }[]).map((f) => f.hoja_id))]
  if (ids.length === 0) return []
  const { data: hojas, error: errorHojas } = await supabase.from('hojas_fabricacion').select('nombre,creada_en').in('id', ids).order('creada_en', { ascending: false })
  if (errorHojas) throw new Error(errorHojas.message)
  return ((hojas ?? []) as { nombre: string }[]).map((h) => h.nombre)
}

/* Crea la hoja con esos pedidos (por número). Todo o nada: si un número no existe, no se crea
   nada y el error lo dice. Devuelve el id de la hoja nueva. */
export async function crearHoja(nombre: string, pedidos: readonly string[]): Promise<string> {
  const { data, error } = await supabase.rpc('crear_hoja_fabricacion', { p_nombre: nombre.trim(), p_pedidos: [...pedidos] })
  if (error) throw new Error(error.message)
  return data as string
}
