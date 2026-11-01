export type UserRole = 'administrador' | 'vendedor' | 'bodega'

export type UbicacionStock = 'bodega' | 'showroom'

export type CanalVenta = 'online' | 'showroom'

export interface Producto {
  id: string
  modelo: string
  descripcion: string | null
}

/* Fila del listado de inventario: una variante con su producto y su stock
   ya pivoteado por ubicación (en la BD el stock vive en filas separadas
   de `inventario`, una por ubicación). */
export interface ProductoVariante {
  id: string
  productoId: string
  modelo: string
  descripcion: string | null
  color: string
  material: string
  sku: string
  precio: number
  stockBodega: number
  stockShowroom: number
}

export interface VentaItem {
  varianteId: string
  sku: string
  modelo: string
  color: string
  material: string
  cantidad: number
  precioUnitario: number
}

/* Una venta ya armada para mostrar. El `total` no existe como columna:
   se calcula sumando las líneas de `venta_items`. */
export interface Venta {
  id: string
  fecha: string
  canal: CanalVenta
  vendedorId: string
  vendedorNombre: string
  items: VentaItem[]
  unidades: number
  total: number
}

export interface Usuario {
  id: string
  nombre: string
  email: string
  rol: UserRole
  creadoEn: string
}

/* ---- Producción (órdenes de fabricación que llegan de Shopify) ---- */

export type EstadoOrden = 'por_fabricar' | 'fabricado' | 'en_despacho' | 'entregado'

/* b, i, a, c: etapas de fabricación. listo: el mueble terminó. */
export type Etapa = 'b' | 'i' | 'a' | 'c' | 'listo'

/* De dónde vino el pedido en Shopify. "web" es la tienda en línea; todo lo
   demás (pedido de borrador, POS, app móvil...) es un pedido manual. */
export type OrigenOrden = 'tienda_en_linea' | 'manual_shopify'

/* Una orden = un mueble. Aquí NO hay datos personales del cliente: viven en
   otra tabla (DatosClienteOrden) que solo se pide al abrir el detalle. */
export interface OrdenFabricacion {
  id: string
  numero: string
  pedidoNumero: string
  shopifyOrderId: string
  tipo: string | null
  modelo: string | null
  orientacion: string | null
  cm: string | null
  color: string | null
  tela: string | null
  region: string | null
  comuna: string | null
  comunaRevisar: boolean
  patas: string
  /* YYYY-MM-DD en hora de Chile. */
  fechaPedido: string
  tituloShopify: string | null
  esAdicional: boolean
  etapaB: boolean
  etapaI: boolean
  etapaA: boolean
  etapaC: boolean
  listo: boolean
  listoEn: string | null
  estado: EstadoOrden
  canceladoEn: string | null
  /* La nota del pedido sin RUT, teléfonos ni correos. */
  notasProduccion: string | null
  /* Null si Shopify no informó el origen. `origenShopify` es el valor crudo
     (sourceName: "web", "shopify_draft_order", "pos"...). */
  origen: OrigenOrden | null
  origenShopify: string | null
  /* Cuándo salió a despacho. Las órdenes que ya estaban en despacho antes de
     la migración 0013 no lo tienen. */
  despachadoEn: string | null
  actualizadoEn: string
}

export interface DatosClienteOrden {
  cliente: string | null
  telefono: string | null
  /* Texto completo original, con RUT y teléfono. */
  infAdicional: string | null
  direccion: string | null
}
