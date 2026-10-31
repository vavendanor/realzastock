export type UserRole = 'administrador' | 'vendedor' | 'bodega'

export type EstadoPedido = 'pendiente' | 'en_preparacion' | 'despachado' | 'entregado'

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

export interface PedidoItem {
  varianteId: string
  sku: string
  modelo: string
  color: string
  material: string
  cantidad: number
  /* Si el pedido nace de una venta, el precio al que se vendió; si no, el
     del catálogo actual. */
  precio: number
}

/* Las 4 primeras son obligatorias en la BD; la referencia es opcional. */
export interface DireccionDespacho {
  calle: string
  comuna: string
  ciudad: string
  region: string
  referencia: string | null
}

export interface Pedido {
  id: string
  clienteNombre: string
  clienteContacto: string | null
  direccion: DireccionDespacho
  /* Venta de la que nació el pedido. Si existe, el stock ya se descontó al
     vender y despachar no lo vuelve a descontar. */
  ventaId: string | null
  estado: EstadoPedido
  fechaCreacion: string
  fechaActualizacion: string
  responsableId: string
  responsableNombre: string
  items: PedidoItem[]
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
