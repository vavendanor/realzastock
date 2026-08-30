export type UserRole = 'administrador' | 'vendedor' | 'bodega'

export type EstadoPedido = 'pendiente' | 'en_preparacion' | 'despachado' | 'entregado'

export interface ProductoVariante {
  id: string
  modelo: string
  color: string
  material: string
  precio: number
  stockBodega: number
  stockShowroom: number
}
