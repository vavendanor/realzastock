import type { DatosClienteOrden, EstadoOrden, Etapa, OrdenFabricacion, OrigenOrden } from '../types'
import { ESTADO_ORDEN_LABEL, ORDEN_ESTADOS_ORDEN, ORDEN_ORIGENES, ORIGEN_LABEL } from './etiquetas'
import type { CambioDeLote } from './cambiosPendientes'
import { supabase } from './supabaseClient'

export { ESTADO_ORDEN_LABEL, ORDEN_ESTADOS_ORDEN, ORDEN_ORIGENES, ORIGEN_LABEL }

/* Réplica de `avanzar_estado_orden` (migración 0012) para decidir qué botón
   mostrar. "Por fabricar" no avanza con botón: sale de ahí marcando LISTO.
   La validación real ocurre en el servidor. */
export const ESTADO_ORDEN_SIGUIENTE: Record<EstadoOrden, EstadoOrden | null> = {
  por_fabricar: null,
  fabricado: 'en_despacho',
  en_despacho: 'entregado',
  entregado: null,
}

export const ETAPAS: { id: Etapa; etiqueta: string }[] = [
  { id: 'b', etiqueta: 'B' },
  { id: 'i', etiqueta: 'I' },
  { id: 'a', etiqueta: 'A' },
  { id: 'c', etiqueta: 'C' },
  { id: 'listo', etiqueta: 'LISTO' },
]

export function etapaMarcada(orden: OrdenFabricacion, etapa: Etapa) {
  switch (etapa) {
    case 'b':
      return orden.etapaB
    case 'i':
      return orden.etapaI
    case 'a':
      return orden.etapaA
    case 'c':
      return orden.etapaC
    case 'listo':
      return orden.listo
  }
}

/* Una orden en despacho o entregada ya no cambia de etapas (lo hace cumplir
   también `marcar_etapa` en la base de datos). */
export function etapasBloqueadas(orden: OrdenFabricacion) {
  return orden.canceladoEn !== null || orden.estado === 'en_despacho' || orden.estado === 'entregado'
}

/* El mismo cambio que hará el servidor, para mostrarlo al instante mientras
   llega la respuesta. */
export function aplicarEtapaLocal(orden: OrdenFabricacion, etapa: Etapa, valor: boolean): OrdenFabricacion {
  switch (etapa) {
    case 'b':
      return { ...orden, etapaB: valor }
    case 'i':
      return { ...orden, etapaI: valor }
    case 'a':
      return { ...orden, etapaA: valor }
    case 'c':
      return { ...orden, etapaC: valor }
    case 'listo':
      return { ...orden, listo: valor, estado: valor ? 'fabricado' : 'por_fabricar', listoOrigen: valor ? 'app' : null }
  }
}

/* "2026-10-31" -> "31-10-2026". Sin pasar por Date: así no hay corrimientos
   de zona horaria (un día "31" no puede pasar a "30"). */
export function formatearFechaPedido(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

/* YYYY-MM-DD con la fecha del dispositivo (no la de UTC). */
export function fechaLocal(fecha: Date) {
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`
}

/* ------------------------------------------------------------------ */

const COLUMNAS_ORDEN =
  'id,numero,pedido_numero,shopify_order_id,tipo,modelo,orientacion,cm,color,tela,region,comuna,comuna_revisar,patas,' +
  'fecha_pedido,titulo_shopify,es_adicional,etapa_b,etapa_i,etapa_a,etapa_c,listo,listo_en,estado,cancelado_en,notas_produccion,' +
  'origen,origen_shopify,despachado_en,actualizado_en,pedido_creado_en,shopify_preparado,listo_origen'

interface OrdenRaw {
  id: string
  numero: string
  pedido_numero: string
  shopify_order_id: string
  tipo: string | null
  modelo: string | null
  orientacion: string | null
  cm: string | null
  color: string | null
  tela: string | null
  region: string | null
  comuna: string | null
  comuna_revisar: boolean
  patas: string
  fecha_pedido: string
  titulo_shopify: string | null
  es_adicional: boolean
  etapa_b: boolean
  etapa_i: boolean
  etapa_a: boolean
  etapa_c: boolean
  listo: boolean
  listo_en: string | null
  estado: EstadoOrden
  cancelado_en: string | null
  notas_produccion: string | null
  origen: OrigenOrden | null
  origen_shopify: string | null
  despachado_en: string | null
  actualizado_en: string
  pedido_creado_en: string
  shopify_preparado: boolean
  listo_origen: 'app' | 'shopify' | null
}

function aplanarOrden(raw: OrdenRaw): OrdenFabricacion {
  return {
    id: raw.id,
    numero: raw.numero,
    pedidoNumero: raw.pedido_numero,
    shopifyOrderId: raw.shopify_order_id,
    tipo: raw.tipo,
    modelo: raw.modelo,
    orientacion: raw.orientacion,
    cm: raw.cm,
    color: raw.color,
    tela: raw.tela,
    region: raw.region,
    comuna: raw.comuna,
    comunaRevisar: raw.comuna_revisar,
    patas: raw.patas,
    fechaPedido: raw.fecha_pedido,
    tituloShopify: raw.titulo_shopify,
    esAdicional: raw.es_adicional,
    etapaB: raw.etapa_b,
    etapaI: raw.etapa_i,
    etapaA: raw.etapa_a,
    etapaC: raw.etapa_c,
    listo: raw.listo,
    listoEn: raw.listo_en,
    estado: raw.estado,
    canceladoEn: raw.cancelado_en,
    notasProduccion: raw.notas_produccion,
    origen: raw.origen,
    origenShopify: raw.origen_shopify,
    despachadoEn: raw.despachado_en,
    actualizadoEn: raw.actualizado_en,
    pedidoCreadoEn: raw.pedido_creado_en,
    shopifyPreparado: raw.shopify_preparado,
    listoOrigen: raw.listo_origen,
  }
}

/* "1180-2" -> [1180, 2]; "1177" -> [1177, 0]. Para ordenar por número real y
   no como texto ("1180-10" va después de "1180-2"). */
function claveNumero(numero: string): [number, number] {
  const [pedido, unidad] = numero.split('-')
  return [Number(pedido) || 0, Number(unidad) || 0]
}

function ordenarOrdenes(filas: OrdenFabricacion[]) {
  return [...filas].sort((a, b) => {
    if (a.fechaPedido !== b.fechaPedido) return a.fechaPedido < b.fechaPedido ? 1 : -1
    const [pa, ua] = claveNumero(a.numero)
    const [pb, ub] = claveNumero(b.numero)
    return pa !== pb ? pb - pa : ua - ub
  })
}

export const LIMITE_ORDENES = 500

export interface FiltrosOrdenes {
  desde: string
  hasta: string
  estado: EstadoOrden | 'todos'
  comuna: string
  modelo: string
  tela: string
  origen: OrigenOrden | 'todos'
  incluirAdicionales: boolean
}

export const FILTROS_ORDENES_VACIOS: FiltrosOrdenes = {
  desde: '',
  hasta: '',
  estado: 'todos',
  comuna: '',
  modelo: '',
  tela: '',
  origen: 'todos',
  incluirAdicionales: false,
}

/* Cuántos filtros (sin contar "mostrar adicionales") están puestos. */
export function filtrosActivos(f: FiltrosOrdenes) {
  return [f.desde, f.hasta, f.estado !== 'todos' ? f.estado : '', f.comuna, f.modelo, f.tela, f.origen !== 'todos' ? f.origen : ''].filter(
    Boolean,
  ).length
}

/* Los filtros de la pantalla, aplicados a una consulta de ordenes_fabricacion.
   Los usan la lista y la exportación a Excel, para que el archivo contenga
   exactamente lo que se está viendo. Las canceladas nunca se incluyen. */
function aplicarFiltros<T>(consultaInicial: T, filtros: FiltrosOrdenes): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consulta: any = consultaInicial
  consulta = consulta.is('cancelado_en', null)
  if (!filtros.incluirAdicionales) consulta = consulta.eq('es_adicional', false)
  if (filtros.estado !== 'todos') consulta = consulta.eq('estado', filtros.estado)
  if (filtros.desde) consulta = consulta.gte('fecha_pedido', filtros.desde)
  if (filtros.hasta) consulta = consulta.lte('fecha_pedido', filtros.hasta)
  if (filtros.comuna) consulta = consulta.eq('comuna', filtros.comuna)
  if (filtros.modelo) consulta = consulta.eq('modelo', filtros.modelo)
  if (filtros.tela) consulta = consulta.eq('tela', filtros.tela)
  if (filtros.origen !== 'todos') consulta = consulta.eq('origen', filtros.origen)
  return consulta as T
}

/* Nunca trae datos personales del cliente: esos están en otra tabla. Las
   órdenes canceladas en Shopify no se listan. */
export async function listarOrdenes(filtros: FiltrosOrdenes): Promise<{ ordenes: OrdenFabricacion[]; limitado: boolean }> {
  const consulta = aplicarFiltros(supabase.from('ordenes_fabricacion').select(COLUMNAS_ORDEN), filtros)

  const { data, error } = await consulta
    .order('fecha_pedido', { ascending: false })
    .order('pedido_numero', { ascending: false })
    .limit(LIMITE_ORDENES)

  if (error) throw new Error(error.message)
  const filas = ((data ?? []) as unknown as OrdenRaw[]).map(aplanarOrden)
  return { ordenes: ordenarOrdenes(filas), limitado: filas.length >= LIMITE_ORDENES }
}

/* Máximo de filas que se exporta a Excel de una vez. */
export const LIMITE_EXPORTACION = 5000

/* Todas las órdenes que coinciden con los filtros (no solo las 500 de la
   lista), de la más antigua a la más reciente, para el archivo de Excel. Se
   piden de a 1000 porque la API entrega como máximo eso por consulta. */
export async function listarOrdenesParaExportar(filtros: FiltrosOrdenes): Promise<OrdenFabricacion[]> {
  const PAGINA = 1000
  const filas: OrdenFabricacion[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const consulta = aplicarFiltros(supabase.from('ordenes_fabricacion').select(COLUMNAS_ORDEN), filtros)
      .order('pedido_creado_en', { ascending: true })
      .order('pedido_numero', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, desde + PAGINA - 1)
    const { data, error } = await consulta
    if (error) throw new Error(error.message)
    const lote = ((data ?? []) as unknown as OrdenRaw[]).map(aplanarOrden)
    filas.push(...lote)
    if (filas.length > LIMITE_EXPORTACION) {
      throw new Error(`Hay más de ${LIMITE_EXPORTACION} órdenes con estos filtros. Acota las fechas e inténtalo de nuevo.`)
    }
    if (lote.length < PAGINA) break
  }
  return filas
}

/* Solo el NOMBRE del cliente de cada orden. Nunca se pide la nota original
   (con RUT), el teléfono ni la dirección: el Excel no los lleva. */
export async function obtenerNombresClientes(ordenIds: string[]): Promise<Map<string, string>> {
  const nombres = new Map<string, string>()
  for (let i = 0; i < ordenIds.length; i += 100) {
    const { data, error } = await supabase.from('ordenes_fabricacion_cliente').select('orden_id,cliente').in('orden_id', ordenIds.slice(i, i + 100))
    if (error) throw new Error(error.message)
    for (const f of (data ?? []) as { orden_id: string; cliente: string | null }[]) if (f.cliente) nombres.set(f.orden_id, f.cliente)
  }
  return nombres
}

/* Las órdenes más recientes (solo muebles, sin adicionales ni canceladas), para
   el Dashboard. */
export async function listarUltimasOrdenes(cantidad = 5): Promise<OrdenFabricacion[]> {
  const { data, error } = await supabase
    .from('ordenes_fabricacion')
    .select(COLUMNAS_ORDEN)
    .is('cancelado_en', null)
    .eq('es_adicional', false)
    .order('fecha_pedido', { ascending: false })
    .order('pedido_numero', { ascending: false })
    .limit(cantidad)
  if (error) throw new Error(error.message)
  return ordenarOrdenes(((data ?? []) as unknown as OrdenRaw[]).map(aplanarOrden))
}

export type ConteoEstados = Record<EstadoOrden, number>

/* Un conteo por estado, sin filtros de fecha/comuna/etc.: así las tarjetas de
   resumen no colapsan a un solo número al filtrar. */
export async function contarOrdenesPorEstado(incluirAdicionales: boolean): Promise<ConteoEstados> {
  const contar = async (estado: EstadoOrden) => {
    let consulta = supabase
      .from('ordenes_fabricacion')
      .select('id', { count: 'exact', head: true })
      .is('cancelado_en', null)
      .eq('estado', estado)
    if (!incluirAdicionales) consulta = consulta.eq('es_adicional', false)
    const { count, error } = await consulta
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  const conteos = await Promise.all(ORDEN_ESTADOS_ORDEN.map(contar))
  return Object.fromEntries(ORDEN_ESTADOS_ORDEN.map((e, i) => [e, conteos[i]])) as ConteoEstados
}

/* ¿Hay alguna orden en el sistema (adicionales incluidos)? Distingue "todavía
   no se ha importado nada" de "los filtros no devuelven nada". */
export async function contarOrdenesTotales(): Promise<number> {
  const { count, error } = await supabase
    .from('ordenes_fabricacion')
    .select('id', { count: 'exact', head: true })
    .is('cancelado_en', null)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export interface OpcionesFiltro {
  comunas: string[]
  modelos: string[]
  telas: string[]
}

/* Valores que realmente existen, para los desplegables. La API devuelve como
   máximo 1000 filas por consulta, así que se pide por páginas. */
export async function listarOpcionesFiltro(incluirAdicionales: boolean): Promise<OpcionesFiltro> {
  const comunas = new Set<string>()
  const modelos = new Set<string>()
  const telas = new Set<string>()
  const PAGINA = 1000

  for (let desde = 0; desde < PAGINA * 20; desde += PAGINA) {
    let consulta = supabase
      .from('ordenes_fabricacion')
      .select('comuna,modelo,tela')
      .is('cancelado_en', null)
      .range(desde, desde + PAGINA - 1)
    if (!incluirAdicionales) consulta = consulta.eq('es_adicional', false)
    const { data, error } = await consulta
    if (error) throw new Error(error.message)
    const filas = (data ?? []) as { comuna: string | null; modelo: string | null; tela: string | null }[]
    for (const f of filas) {
      if (f.comuna) comunas.add(f.comuna)
      if (f.modelo) modelos.add(f.modelo)
      if (f.tela) telas.add(f.tela)
    }
    if (filas.length < PAGINA) break
  }

  const ordenar = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, 'es'))
  return { comunas: ordenar(comunas), modelos: ordenar(modelos), telas: ordenar(telas) }
}

export interface OrdenCompleta {
  orden: OrdenFabricacion
  /* Los otros muebles del mismo pedido de Shopify. */
  hermanas: OrdenFabricacion[]
  /* Datos personales: solo se piden aquí, al abrir una orden. La base de
     datos solo los entrega a administrador y bodega. */
  cliente: DatosClienteOrden | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function obtenerOrden(id: string): Promise<OrdenCompleta> {
  /* Una dirección como /pedidos/nuevo (del flujo antiguo) o con un id mal
     escrito no es un uuid: se evita pedírselo a la base de datos, que
     respondería con un error técnico. */
  if (!UUID.test(id)) throw new Error('No se encontró la orden, o no tienes acceso a ella.')

  const { data, error } = await supabase.from('ordenes_fabricacion').select(COLUMNAS_ORDEN).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('No se encontró la orden, o no tienes acceso a ella.')
  const orden = aplanarOrden(data as unknown as OrdenRaw)

  const [hermanasRes, clienteRes] = await Promise.all([
    supabase
      .from('ordenes_fabricacion')
      .select(COLUMNAS_ORDEN)
      .eq('shopify_order_id', orden.shopifyOrderId)
      .is('cancelado_en', null)
      .neq('id', id),
    supabase.from('ordenes_fabricacion_cliente').select('cliente,telefono,inf_adicional,direccion').eq('orden_id', id).maybeSingle(),
  ])
  if (hermanasRes.error) throw new Error(hermanasRes.error.message)
  if (clienteRes.error) throw new Error(clienteRes.error.message)

  const cliente = clienteRes.data as {
    cliente: string | null
    telefono: string | null
    inf_adicional: string | null
    direccion: string | null
  } | null

  return {
    orden,
    /* ordenarOrdenes deja lo más reciente primero; dentro de un mismo pedido
       interesa 1, 2, 3..., así que se ordena por número ascendente. */
    hermanas: ((hermanasRes.data ?? []) as unknown as OrdenRaw[])
      .map(aplanarOrden)
      .sort((a, b) => claveNumero(a.numero)[1] - claveNumero(b.numero)[1]),
    cliente: cliente
      ? { cliente: cliente.cliente, telefono: cliente.telefono, infAdicional: cliente.inf_adicional, direccion: cliente.direccion }
      : null,
  }
}

export async function marcarEtapa(ordenId: string, etapa: Etapa, valor: boolean): Promise<OrdenFabricacion> {
  const { data, error } = await supabase.rpc('marcar_etapa', {
    p_orden_id: ordenId,
    p_etapa: etapa,
    p_valor: valor,
  })
  if (error) throw new Error(error.message)
  return aplanarOrden(data as unknown as OrdenRaw)
}

/* Aplica de una vez un lote de casillas (guardar_cambios_etapas, migración 0017):
   todo o nada, con comparación contra el valor esperado. Si el servidor rechaza
   el lote, lanza un error con "code" y "details" (el detalle de los problemas,
   en JSON) para que lo interprete cambiosPendientes.interpretarError. Devuelve
   las órdenes que quedaron actualizadas. */
export async function guardarCambiosEtapas(cambios: CambioDeLote[]): Promise<OrdenFabricacion[]> {
  const { data, error } = await supabase.rpc('guardar_cambios_etapas', { p_cambios: cambios })
  if (error) throw Object.assign(new Error(error.message), { details: error.details ?? null, code: error.code ?? null })
  return ((data ?? []) as unknown as OrdenRaw[]).map(aplanarOrden)
}

export async function avanzarEstadoOrden(ordenId: string): Promise<EstadoOrden> {
  const { data, error } = await supabase.rpc('avanzar_estado_orden', { p_orden_id: ordenId })
  if (error) throw new Error(error.message)
  return data as EstadoOrden
}
