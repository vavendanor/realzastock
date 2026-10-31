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

/* Calle, comuna y región son obligatorias; la referencia es opcional. */
export interface DireccionDespacho {
  calle: string
  comuna: string
  /* Ya no se pide en el formulario (región y comuna salen de listas), pero
     los pedidos anteriores la conservan. */
  ciudad: string | null
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
  /* Cuándo y desde dónde se despachó. Solo existen en pedidos despachados
     después de la migración 0010; los anteriores quedan en null. Con venta,
     `despachadoDesde` también es null: al despachar no se movió stock. */
  despachadoEn: string | null
  despachadoDesde: UbicacionStock | null
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
