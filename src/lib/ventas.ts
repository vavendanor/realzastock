import type { CanalVenta, UbicacionStock, Venta, VentaItem } from '../types'
import { supabase } from './supabaseClient'

export const CANALES: { value: CanalVenta; label: string }[] = [
  { value: 'showroom', label: 'Showroom' },
  { value: 'online', label: 'Online' },
]

export function etiquetaCanal(canal: CanalVenta) {
  return CANALES.find((c) => c.value === canal)?.label ?? canal
}

/* Ubicación desde la que sale el producto según el canal. Es solo el valor
   por defecto que propone el formulario: el vendedor puede cambiarlo, porque
   una venta online puede despacharse con la unidad del showroom. */
export function ubicacionPorDefecto(canal: CanalVenta): UbicacionStock {
  return canal === 'showroom' ? 'showroom' : 'bodega'
}

interface VentaRaw {
  id: string
  fecha: string
  canal: CanalVenta
  vendedor_id: string
  usuarios: { nombre: string; email: string } | null
  venta_items: {
    cantidad: number
    precio_unitario: number
    variantes: {
      id: string
      sku: string
      color: string
      material: string
      productos: { modelo: string } | null
    } | null
  }[]
}

function aplanar(raw: VentaRaw): Venta {
  const items: VentaItem[] = raw.venta_items.map((item) => ({
    varianteId: item.variantes?.id ?? '',
    sku: item.variantes?.sku ?? '(variante eliminada)',
    modelo: item.variantes?.productos?.modelo ?? '(producto eliminado)',
    color: item.variantes?.color ?? '',
    material: item.variantes?.material ?? '',
    cantidad: item.cantidad,
    precioUnitario: Number(item.precio_unitario),
  }))

  return {
    id: raw.id,
    fecha: raw.fecha,
    canal: raw.canal,
    vendedorId: raw.vendedor_id,
    /* Un vendedor solo puede leer su propia fila de `usuarios` por RLS, así
       que en sus propias ventas el nombre llega igual; si algún día no
       llegara, se cae al correo y después a un guion. */
    vendedorNombre: raw.usuarios?.nombre ?? raw.usuarios?.email ?? '—',
    items,
    unidades: items.reduce((suma, item) => suma + item.cantidad, 0),
    total: items.reduce((suma, item) => suma + item.cantidad * item.precioUnitario, 0),
  }
}

const SELECT_VENTA = `
  id, fecha, canal, vendedor_id,
  usuarios ( nombre, email ),
  venta_items (
    cantidad, precio_unitario,
    variantes ( id, sku, color, material, productos ( modelo ) )
  )
`

export interface FiltrosVentas {
  desde?: string
  hasta?: string
  canal?: CanalVenta | 'todos'
}

/* RLS decide el alcance: el administrador recibe todas las ventas y el
   vendedor solo las suyas. La consulta es la misma para ambos. */
export async function listarVentas(filtros: FiltrosVentas = {}): Promise<Venta[]> {
  let query = supabase.from('ventas').select(SELECT_VENTA).order('fecha', { ascending: false })

  if (filtros.desde) query = query.gte('fecha', `${filtros.desde}T00:00:00`)
  /* `hasta` es inclusivo: se compara contra el final de ese día. */
  if (filtros.hasta) query = query.lte('fecha', `${filtros.hasta}T23:59:59.999`)
  if (filtros.canal && filtros.canal !== 'todos') query = query.eq('canal', filtros.canal)

  const { data, error } = await query

  if (error) throw new Error(error.message)
  return (data as unknown as VentaRaw[]).map(aplanar)
}

export interface ItemNuevaVenta {
  variante_id: string
  cantidad: number
}

/* Llama a la función plpgsql de la migración 0004: crea la cabecera, las
   líneas y descuenta el stock dentro de una sola transacción. Si el stock
   no alcanza, no se escribe nada. */
export async function registrarVenta(
  canal: CanalVenta,
  ubicacion: UbicacionStock,
  items: ItemNuevaVenta[],
): Promise<string> {
  const { data, error } = await supabase.rpc('registrar_venta', {
    p_canal: canal,
    p_ubicacion: ubicacion,
    p_items: items,
  })

  if (error) {
    /* Los mensajes de las excepciones de la función ya vienen redactados
       para mostrarse tal cual; el resto se deja pasar como viene. */
    throw new Error(error.message)
  }

  return data as string
}
