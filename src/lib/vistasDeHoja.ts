import type { OrdenFabricacion } from '../types'
import { compararPedido, esPiezaDeHoja } from './excelHoja'

/* Cómo se agrupan las piezas de una hoja en /hojas/:id. Lógica pura: no consulta nada, solo ordena y
   agrupa lo que ya se leyó. Las piezas que se muestran son los muebles y cojines que no están
   cancelados (igual que en las tarjetas y en el Excel). */

const unidadDe = (o: OrdenFabricacion) => Number(o.numero.split('-')[1]) || 0
const compararPieza = (a: OrdenFabricacion, b: OrdenFabricacion) => compararPedido(a.pedidoNumero, b.pedidoNumero) || unidadDe(a) - unidadDe(b)

export interface GrupoPedido {
  pedido: string
  /* Fecha del pedido (la más antigua de sus piezas) y desde cuándo corre el plazo, si se fijó a mano. */
  fechaPedido: string | null
  plazoDesde: string | null
  piezas: OrdenFabricacion[]
  /* El pedido no tiene piezas activas: todas fueron canceladas (o no se ven). La hoja lo avisa. */
  cancelado: boolean
}

/* `asignados`: los pedidos que la hoja tiene (incluye los que hoy no muestran ninguna pieza). */
export function agruparPorPedido(ordenes: readonly OrdenFabricacion[], asignados: readonly string[]): GrupoPedido[] {
  const numeros = new Set([...asignados, ...ordenes.map((o) => o.pedidoNumero)])
  return [...numeros].sort(compararPedido).map((pedido) => {
    const todas = ordenes.filter((o) => o.pedidoNumero === pedido)
    const activas = todas.filter((o) => o.canceladoEn === null)
    const piezas = activas.filter(esPiezaDeHoja).sort(compararPieza)
    return {
      pedido,
      fechaPedido: activas.length ? activas.reduce((m, o) => (o.fechaPedido < m ? o.fechaPedido : m), activas[0].fechaPedido) : null,
      plazoDesde: activas.find((o) => o.plazoDesde)?.plazoDesde ?? null,
      piezas,
      cancelado: activas.length === 0,
    }
  })
}

export interface ResumenDeHoja {
  pedidos: number
  piezas: number
  pendientes: number
}

export function resumirHoja(ordenes: readonly OrdenFabricacion[], asignados: readonly string[]): ResumenDeHoja {
  const piezas = ordenes.filter(esPiezaDeHoja)
  return { pedidos: new Set([...asignados, ...ordenes.map((o) => o.pedidoNumero)]).size, piezas: piezas.length, pendientes: piezas.filter((o) => o.estado === 'por_fabricar').length }
}
