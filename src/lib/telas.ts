import { supabase } from './supabaseClient'

/* El inventario de telas: 4 telas (Lino, Cuero, Semicuero y Tela hidrorepelente) con su cantidad en metros y su stock
   mínimo. Solo el administrador lo ve y lo ajusta (tabla `telas`, migración 0019). */
export interface Tela {
  id: string
  nombre: string
  metros: number
  stockMinimo: number
}

interface TelaRaw {
  id: string
  nombre: string
  metros: number | string
  stock_minimo: number | string
}

const aplanar = (raw: TelaRaw): Tela => ({ id: raw.id, nombre: raw.nombre, metros: Number(raw.metros), stockMinimo: Number(raw.stock_minimo) })

/* Una tela está en alerta cuando su cantidad es igual o menor a su mínimo. */
export const estaBajoMinimo = (t: Pick<Tela, 'metros' | 'stockMinimo'>) => t.metros <= t.stockMinimo

/* Las telas en alerta, las más escasas primero (por lo que les falta para llegar al mínimo). */
export const telasEnAlerta = (telas: readonly Tela[]) =>
  telas.filter(estaBajoMinimo).sort((a, b) => a.metros - a.stockMinimo - (b.metros - b.stockMinimo) || a.nombre.localeCompare(b.nombre, 'es'))

/* "72,5 m" / "100 m": hasta 2 decimales, coma decimal. */
export const formatearMetros = (n: number) => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)} m`

/* Un número escrito en la pantalla ("72,5" o "72.5"). null si no es un número de 0 o más. */
export function leerMetros(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (t === '' || !/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

export async function listarTelas(): Promise<Tela[]> {
  const { data, error } = await supabase.from('telas').select('id, nombre, metros, stock_minimo').order('nombre')
  if (error) throw new Error(error.message)
  return ((data ?? []) as TelaRaw[]).map(aplanar)
}

/* La función de la base valida que sea administrador y que los números no sean negativos. */
export async function ajustarTela(id: string, metros: number, stockMinimo: number): Promise<void> {
  const { error } = await supabase.rpc('ajustar_tela', { p_tela_id: id, p_metros: metros, p_stock_minimo: stockMinimo })
  if (error) throw new Error(error.message)
}
