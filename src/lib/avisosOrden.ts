import type { OrdenFabricacion } from '../types'

/* Avisos para quien mira la lista de producción. Son solo ayudas visuales:
   no cambian ningún dato. */

/* Qué le falta a un mueble para poder fabricarlo sin dudas. Aplica a muebles,
   no a adicionales (patas extra, cojines...). Pasa con los pedidos creados a
   mano en Shopify sin variante: el color y la tela solo están en la nota. */
export type FaltaColorTela = 'color' | 'tela' | 'color y tela'

export function faltaColorTela(o: Pick<OrdenFabricacion, 'esAdicional' | 'color' | 'tela'>): FaltaColorTela | null {
  if (o.esAdicional) return null
  const sinColor = !o.color?.trim()
  const sinTela = !o.tela?.trim()
  if (sinColor && sinTela) return 'color y tela'
  if (sinColor) return 'color'
  if (sinTela) return 'tela'
  return null
}

/* La columna "patas" casi nunca se llena en Shopify (siempre dice
   PREDETERMINADAS), pero los pedidos suelen pedirlas en la nota ("patas
   metálicas negras"). Si la nota las nombra y el campo no dice otra cosa,
   conviene avisar para que no se fabrique con las patas por defecto. */
const PATAS = /\bpatas?\b/i

export function mencionaPatas(o: Pick<OrdenFabricacion, 'esAdicional' | 'notasProduccion' | 'patas'>): boolean {
  if (o.esAdicional) return false
  if (o.patas && o.patas.trim().toUpperCase() !== 'PREDETERMINADAS') return false
  return PATAS.test(o.notasProduccion ?? '')
}

/* "Preparado" de Shopify. Cuando la sincronización sube una unidad a
   "fabricado" porque en Shopify el pedido está preparado, queda marcada como
   LISTO por Shopify. */
export function preparadoPorShopify(o: Pick<OrdenFabricacion, 'listoOrigen'>): boolean {
  return o.listoOrigen === 'shopify'
}

/* La app NUNCA baja un estado porque Shopify desmarque: solo avisa. Se nota
   cuando la unidad la subió Shopify, sigue "fabricado" y Shopify ya no la
   tiene preparada. */
export function shopifyDesmarco(o: Pick<OrdenFabricacion, 'listoOrigen' | 'estado' | 'shopifyPreparado'>): boolean {
  return o.listoOrigen === 'shopify' && o.estado === 'fabricado' && !o.shopifyPreparado
}
