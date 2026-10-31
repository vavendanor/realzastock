import type { DireccionDespacho, EstadoPedido, Pedido, PedidoItem, UbicacionStock } from '../types'
import { supabase } from './supabaseClient'

/* El único estado siguiente válido para cada estado, replicando la máquina
   de estados que ya vive en la función `avanzar_estado_pedido` de la BD.
   Sirve para decidir qué botón mostrar en la UI; la validación real (la
   que importa) ocurre en el servidor. */
export const ESTADO_SIGUIENTE: Record<EstadoPedido, EstadoPedido | null> = {
  pendiente: 'en_preparacion',
  en_preparacion: 'despachado',
  despachado: 'entregado',
  entregado: null,
}

export const ESTADO_LABEL: Record<EstadoPedido, string> = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparación',
  despachado: 'Despachado',
  entregado: 'Entregado',
}

export const ORDEN_ESTADOS: EstadoPedido[] = ['pendiente', 'en_preparacion', 'despachado', 'entregado']

/* Formato legible de una sola línea, para quien despacha. La referencia va
   entre paréntesis al final porque es una aclaración, no parte de la
   dirección postal en sí. */
export function formatearDireccion(direccion: DireccionDespacho) {
  const base = `${direccion.calle}, ${direccion.comuna}, ${direccion.ciudad}, ${direccion.region}`
  return direccion.referencia ? `${base} (${direccion.referencia})` : base
}

interface PedidoRaw {
  id: string
  cliente_nombre: string
  cliente_contacto: string | null
  direccion_calle: string
  direccion_comuna: string
  direccion_ciudad: string
  direccion_region: string
  direccion_referencia: string | null
  venta_id: string | null
  estado: EstadoPedido
  fecha_creacion: string
  fecha_actualizacion: string
  responsable_id: string
  usuarios: { nombre: string; email: string } | null
  pedido_items: {
    cantidad: number
    precio_unitario: number | null
    variantes: {
      id: string
      sku: string
      color: string
      material: string
      precio: number
      productos: { modelo: string } | null
    } | null
  }[]
}

function aplanar(raw: PedidoRaw): Pedido {
  const items: PedidoItem[] = raw.pedido_items.map((item) => ({
    varianteId: item.variantes?.id ?? '',
    sku: item.variantes?.sku ?? '(variante eliminada)',
    modelo: item.variantes?.productos?.modelo ?? '(producto eliminado)',
    color: item.variantes?.color ?? '',
    material: item.variantes?.material ?? '',
    cantidad: item.cantidad,
    /* `precio_unitario` solo viene cuando el pedido nació de una venta (se
       copia de venta_items al crearlo): es el precio al que se vendió, y no
       cambia aunque después suba o baje el del catálogo. En los pedidos
       sin venta es nulo y se usa el precio actual del catálogo. */
    precio: Number(item.precio_unitario ?? item.variantes?.precio ?? 0),
  }))

  return {
    id: raw.id,
    clienteNombre: raw.cliente_nombre,
    clienteContacto: raw.cliente_contacto,
    direccion: {
      calle: raw.direccion_calle,
      comuna: raw.direccion_comuna,
      ciudad: raw.direccion_ciudad,
      region: raw.direccion_region,
      referencia: raw.direccion_referencia,
    },
    ventaId: raw.venta_id,
    estado: raw.estado,
    fechaCreacion: raw.fecha_creacion,
    fechaActualizacion: raw.fecha_actualizacion,
    responsableId: raw.responsable_id,
    responsableNombre: raw.usuarios?.nombre ?? raw.usuarios?.email ?? '—',
    items,
    unidades: items.reduce((suma, item) => suma + item.cantidad, 0),
    total: items.reduce((suma, item) => suma + item.cantidad * item.precio, 0),
  }
}

const SELECT_PEDIDO = `
  id, cliente_nombre, cliente_contacto,
  direccion_calle, direccion_comuna, direccion_ciudad, direccion_region, direccion_referencia,
  venta_id, estado, fecha_creacion, fecha_actualizacion, responsable_id,
  usuarios ( nombre, email ),
  pedido_items (
    cantidad, precio_unitario,
    variantes ( id, sku, color, material, precio, productos ( modelo ) )
  )
`

export interface FiltrosPedidos {
  estado?: EstadoPedido | 'todos'
}

/* RLS decide el alcance: administrador y bodega reciben todos los pedidos,
   el vendedor solo los suyos. La consulta es la misma para los tres roles. */
export async function listarPedidos(filtros: FiltrosPedidos = {}): Promise<Pedido[]> {
  let query = supabase.from('pedidos').select(SELECT_PEDIDO).order('fecha_creacion', { ascending: false })

  if (filtros.estado && filtros.estado !== 'todos') query = query.eq('estado', filtros.estado)

  const { data, error } = await query

  if (error) throw new Error(error.message)
  return (data as unknown as PedidoRaw[]).map(aplanar)
}

export async function obtenerPedido(id: string): Promise<Pedido> {
  const { data, error } = await supabase.from('pedidos').select(SELECT_PEDIDO).eq('id', id).single()

  if (error) throw new Error(error.message)
  return aplanar(data as unknown as PedidoRaw)
}

export interface ItemNuevoPedido {
  variante_id: string
  cantidad: number
}

/* Los 4 primeros campos son obligatorios; `referencia` es opcional. */
export interface DatosNuevoPedido {
  clienteNombre: string
  clienteContacto: string
  direccionCalle: string
  direccionComuna: string
  direccionCiudad: string
  direccionRegion: string
  direccionReferencia: string
}

/* Llama a la función plpgsql de la migración 0008: crea la cabecera (con
   la dirección de despacho) y las líneas dentro de una sola transacción.
   - Sin `ventaId`: valida stock combinado (bodega + showroom) sin descontarlo.
   - Con `ventaId`: los productos se copian de la venta en el servidor (se
     ignora `items`) y no se valida stock, porque ya se descontó al vender. */
export async function crearPedido(
  datos: DatosNuevoPedido,
  items: ItemNuevoPedido[],
  ventaId?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('crear_pedido', {
    p_cliente_nombre: datos.clienteNombre,
    p_cliente_contacto: datos.clienteContacto,
    p_direccion_calle: datos.direccionCalle,
    p_direccion_comuna: datos.direccionComuna,
    p_direccion_ciudad: datos.direccionCiudad,
    p_direccion_region: datos.direccionRegion,
    p_direccion_referencia: datos.direccionReferencia,
    p_items: items,
    /* Solo se envía si hay venta: así el frontend funciona igual antes y
       después de aplicar la migración. */
    ...(ventaId ? { p_venta_id: ventaId } : {}),
  })

  if (error) throw new Error(error.message)
  return data as string
}

/* Avanza el pedido a su único estado siguiente válido. `ubicacion` solo es
   obligatoria cuando el siguiente estado es "despachado" (de ahí sale el
   stock); se ignora en las demás transiciones. */
export async function avanzarEstadoPedido(pedidoId: string, ubicacion?: UbicacionStock): Promise<EstadoPedido> {
  const { data, error } = await supabase.rpc('avanzar_estado_pedido', {
    p_pedido_id: pedidoId,
    p_ubicacion: ubicacion ?? null,
  })

  if (error) throw new Error(error.message)
  return data as EstadoPedido
}
