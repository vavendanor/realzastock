import type { ProductoVariante, UbicacionStock } from '../types'
import { supabase } from './supabaseClient'

/* El esquema todavía no tiene una columna de stock mínimo por variante, así
   que el umbral de "stock bajo" es por ahora un valor de UI compartido.
   Cuando exista `variantes.stock_minimo`, reemplazar por ese dato. */
export const STOCK_MINIMO_DEFAULT = 6

/* Forma cruda que devuelve el join de Supabase, antes de aplanar. */
interface VarianteRaw {
  id: string
  producto_id: string
  color: string
  material: string
  sku: string
  precio: number
  productos: { id: string; modelo: string; descripcion: string | null } | null
  inventario: { ubicacion: UbicacionStock; cantidad: number }[]
}

function aplanar(raw: VarianteRaw): ProductoVariante {
  const stock = (ubicacion: UbicacionStock) =>
    raw.inventario.find((fila) => fila.ubicacion === ubicacion)?.cantidad ?? 0

  return {
    id: raw.id,
    productoId: raw.producto_id,
    modelo: raw.productos?.modelo ?? '(producto sin nombre)',
    descripcion: raw.productos?.descripcion ?? null,
    color: raw.color,
    material: raw.material,
    sku: raw.sku,
    precio: Number(raw.precio),
    stockBodega: stock('bodega'),
    stockShowroom: stock('showroom'),
  }
}

const SELECT_VARIANTE = `
  id, producto_id, color, material, sku, precio,
  productos ( id, modelo, descripcion ),
  inventario ( ubicacion, cantidad )
`

export async function listarVariantes(): Promise<ProductoVariante[]> {
  const { data, error } = await supabase.from('variantes').select(SELECT_VARIANTE).order('sku')

  if (error) throw new Error(error.message)
  return (data as unknown as VarianteRaw[]).map(aplanar)
}
