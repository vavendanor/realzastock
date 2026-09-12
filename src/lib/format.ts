/* Colores de tapiz del catálogo, usados para los swatches del listado.
   Vienen del sistema de diseño; los colores que no estén acá caen a un
   gris neutro, así que agregar un color nuevo en la BD no rompe la vista. */
export const TAPICES: Record<string, string> = {
  Crudo: '#F2EDE4',
  Beige: '#E4D3B4',
  Gris: '#8C8C8C',
  'Gris oscuro': '#4A4A4A',
  'Azul marino': '#2C3A73',
  Chocolate: '#6B4326',
  'Café claro': '#C08552',
  Marrón: '#8A5A34',
  Negro: '#141414',
}

export function colorDeTapiz(color: string) {
  return TAPICES[color] ?? 'var(--tinta-300)'
}

export function clp(monto: number) {
  return `$${monto.toLocaleString('es-CL')}`
}

/* Fechas en formato 'YYYY-MM-DD', el que esperan los filtros de fecha de
   Supabase y los <input type="date">. */
export function hoy() {
  return new Date().toISOString().slice(0, 10)
}

export function haceDias(dias: number) {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  return fecha.toISOString().slice(0, 10)
}
