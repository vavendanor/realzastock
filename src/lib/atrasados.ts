import type { OrdenFabricacion } from '../types'
import { calcularPlazo, inicioDelPlazo, semaforoDelPlazo, type Calendario } from './diasHabiles'
import { esPiezaDeHoja, compararPedido, modeloDeLista } from './excelHoja'
import { leerCalendario } from './feriados'
import { traerTodo } from './hojas'
import { aplanarOrden, COLUMNAS_ORDEN, type OrdenRaw } from './ordenes'
import { supabase } from './supabaseClient'

/* Las piezas atrasadas del Dashboard: las que siguen por fabricar y ya se pasaron del plazo (las que Pedidos y las
   hojas muestran en rojo, "Atrasado N días"). Usa la misma cuenta de días hábiles (calcularPlazo con los feriados) y
   el mismo semáforo que el resto de la app; acá solo se junta y se ordena. No lleva nombre de cliente. */
export interface PiezaAtrasada {
  id: string
  numero: string
  pedido: string
  modelo: string
  comuna: string
  dias: number
}

export function piezasAtrasadas(ordenes: readonly OrdenFabricacion[], calendario: Calendario, hoy: string): { piezas: PiezaAtrasada[]; sinCalendario: boolean } {
  let sinCalendario = false
  const piezas: PiezaAtrasada[] = []
  for (const o of ordenes) {
    if (!esPiezaDeHoja(o) || o.estado !== 'por_fabricar') continue
    const plazo = calcularPlazo(inicioDelPlazo(o), hoy, calendario)
    sinCalendario ||= plazo.sinCalendario
    const semaforo = semaforoDelPlazo(plazo)
    if (semaforo.color !== 'rojo') continue
    piezas.push({ id: o.id, numero: o.numero, pedido: o.pedidoNumero, modelo: modeloDeLista(o) || '—', comuna: o.comuna?.trim() || '—', dias: semaforo.dias })
  }
  piezas.sort((a, b) => b.dias - a.dias || compararPedido(a.pedido, b.pedido) || a.numero.localeCompare(b.numero, 'es'))
  return { piezas, sinCalendario }
}

/* Trae las piezas que siguen por fabricar y calcula cuáles están atrasadas hoy. */
export async function listarPiezasAtrasadas(hoy: string): Promise<{ piezas: PiezaAtrasada[]; sinCalendario: boolean }> {
  const [calendario, filas] = await Promise.all([
    leerCalendario(),
    traerTodo<OrdenRaw>((d, h) =>
      // El texto de columnas no es literal: supabase-js no puede deducir la forma de las filas, que es OrdenRaw.
      supabase.from('ordenes_fabricacion').select(COLUMNAS_ORDEN).eq('estado', 'por_fabricar').is('cancelado_en', null).order('id').range(d, h) as unknown as PromiseLike<{ data: OrdenRaw[] | null; error: { message: string } | null }>,
    ),
  ])
  return piezasAtrasadas(filas.map(aplanarOrden), calendario, hoy)
}
