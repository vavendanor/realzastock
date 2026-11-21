/* Paginador de las listas largas (Pedidos y Despachos). Lógica pura: no sabe de pantallas. */

/* Cuántos se muestran por página: 20 al comienzo, y se puede pasar a 50 o 100. */
export const TAMANOS_DE_PAGINA = [20, 50, 100] as const
export const POR_PAGINA_INICIAL = TAMANOS_DE_PAGINA[0]

export interface Pagina<T> {
  items: T[]
  /* Número de página que se está mostrando (1 como mínimo; si la lista se acortó, la última que existe). */
  pagina: number
  paginas: number
  /* Posición del primero y del último que se muestran ("Mostrando 21–40 de 95"); 0 y 0 si no hay nada. */
  desde: number
  hasta: number
  total: number
}

export function paginar<T>(lista: readonly T[], pagina: number, porPagina: number): Pagina<T> {
  const total = lista.length
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  const actual = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas)
  const inicio = (actual - 1) * porPagina
  const items = lista.slice(inicio, inicio + porPagina)
  return { items, pagina: actual, paginas, desde: total === 0 ? 0 : inicio + 1, hasta: inicio + items.length, total }
}
