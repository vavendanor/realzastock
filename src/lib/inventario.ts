import type { Producto, ProductoVariante, UbicacionStock } from '../types'
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

export async function obtenerVariante(id: string): Promise<ProductoVariante> {
  const { data, error } = await supabase.from('variantes').select(SELECT_VARIANTE).eq('id', id).single()

  if (error) throw new Error(error.message)
  return aplanar(data as unknown as VarianteRaw)
}

/* Variantes hermanas: las demás variantes del mismo producto. Se muestran
   en el formulario de edición para dar contexto de la línea completa. */
export async function listarVariantesDeProducto(productoId: string): Promise<ProductoVariante[]> {
  const { data, error } = await supabase
    .from('variantes')
    .select(SELECT_VARIANTE)
    .eq('producto_id', productoId)
    .order('sku')

  if (error) throw new Error(error.message)
  return (data as unknown as VarianteRaw[]).map(aplanar)
}

export async function listarProductos(): Promise<Producto[]> {
  const { data, error } = await supabase.from('productos').select('id, modelo, descripcion').order('modelo')

  if (error) throw new Error(error.message)
  return data as Producto[]
}

export interface DatosVariante {
  modelo: string
  descripcion: string
  color: string
  material: string
  sku: string
  precio: number
  stockBodega: number
  stockShowroom: number
}

async function guardarStock(varianteId: string, bodega: number, showroom: number) {
  /* `inventario` tiene un unique (variante_id, ubicacion), así que un upsert
     sobre esa clave crea la fila la primera vez y la actualiza después. */
  const { error } = await supabase.from('inventario').upsert(
    [
      { variante_id: varianteId, ubicacion: 'bodega', cantidad: bodega, actualizado_en: new Date().toISOString() },
      { variante_id: varianteId, ubicacion: 'showroom', cantidad: showroom, actualizado_en: new Date().toISOString() },
    ],
    { onConflict: 'variante_id,ubicacion' },
  )

  if (error) throw new Error(error.message)
}

/* Crea producto + variante + sus dos filas de stock.
   Ojo: son inserts separados, no una transacción. Si falla un paso posterior
   se borra lo ya creado para no dejar huérfanos; la forma robusta sería una
   función RPC en Postgres que haga todo en una transacción. */
export async function crearProductoConVariante(datos: DatosVariante): Promise<string> {
  const { data: producto, error: errorProducto } = await supabase
    .from('productos')
    .insert({ modelo: datos.modelo, descripcion: datos.descripcion || null })
    .select('id')
    .single()

  if (errorProducto) throw new Error(errorProducto.message)

  const { data: variante, error: errorVariante } = await supabase
    .from('variantes')
    .insert({
      producto_id: producto.id,
      color: datos.color,
      material: datos.material,
      sku: datos.sku,
      precio: datos.precio,
    })
    .select('id')
    .single()

  if (errorVariante) {
    await supabase.from('productos').delete().eq('id', producto.id)
    throw new Error(errorVariante.message)
  }

  try {
    await guardarStock(variante.id, datos.stockBodega, datos.stockShowroom)
  } catch (error) {
    await supabase.from('productos').delete().eq('id', producto.id)
    throw error
  }

  return variante.id
}

/* Agrega otra variante (color/material distinto) a un producto existente. */
export async function crearVarianteDeProducto(
  productoId: string,
  datos: Omit<DatosVariante, 'modelo' | 'descripcion'>,
): Promise<string> {
  const { data: variante, error } = await supabase
    .from('variantes')
    .insert({
      producto_id: productoId,
      color: datos.color,
      material: datos.material,
      sku: datos.sku,
      precio: datos.precio,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  try {
    await guardarStock(variante.id, datos.stockBodega, datos.stockShowroom)
  } catch (errorStock) {
    await supabase.from('variantes').delete().eq('id', variante.id)
    throw errorStock
  }

  return variante.id
}

export async function actualizarVariante(varianteId: string, productoId: string, datos: DatosVariante) {
  const { error: errorProducto } = await supabase
    .from('productos')
    .update({ modelo: datos.modelo, descripcion: datos.descripcion || null })
    .eq('id', productoId)

  if (errorProducto) throw new Error(errorProducto.message)

  const { error: errorVariante } = await supabase
    .from('variantes')
    .update({ color: datos.color, material: datos.material, sku: datos.sku, precio: datos.precio })
    .eq('id', varianteId)

  if (errorVariante) throw new Error(errorVariante.message)

  await guardarStock(varianteId, datos.stockBodega, datos.stockShowroom)
}

export async function eliminarVariante(varianteId: string) {
  /* Hay que leer el producto antes de borrar: una vez eliminada la variante
     ya no queda forma de saber a qué producto pertenecía. */
  const { data: variante, error: errorLectura } = await supabase
    .from('variantes')
    .select('producto_id')
    .eq('id', varianteId)
    .single()

  if (errorLectura) throw new Error(errorLectura.message)

  /* Las filas de `inventario` caen solas por el ON DELETE CASCADE del esquema. */
  const { error } = await supabase.from('variantes').delete().eq('id', varianteId)
  if (error) {
    /* venta_items y pedido_items apuntan a la variante sin ON DELETE CASCADE,
       a propósito: borrarla borraría el historial de ventas. Postgres rechaza
       el borrado con este código, y su mensaje crudo no le sirve a nadie. */
    if (error.code === '23503') {
      throw new Error(
        'No se puede eliminar esta variante porque tiene ventas o pedidos registrados. Para dejar de venderla, pon su stock en 0.',
      )
    }
    throw new Error(error.message)
  }

  /* Si era la última variante, el producto queda sin nada vendible asociado:
     se elimina para no dejarlo huérfano en el catálogo. */
  const { count, error: errorConteo } = await supabase
    .from('variantes')
    .select('id', { count: 'exact', head: true })
    .eq('producto_id', variante.producto_id)

  if (errorConteo) throw new Error(errorConteo.message)

  if (count === 0) {
    const { error: errorProducto } = await supabase.from('productos').delete().eq('id', variante.producto_id)
    if (errorProducto) throw new Error(errorProducto.message)
  }
}
