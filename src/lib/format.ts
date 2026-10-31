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

/* Teléfono móvil chileno: 9 dígitos, el primero es 9 (ej. 912345678). Es la
   misma regla que valida `crear_pedido` en el servidor. */
const TELEFONO_CHILE = /^9\d{8}$/

/* Deja solo dígitos y como máximo 9. Si se pega un número con prefijo
   (+56 9 1234 5678), se descarta el 56 para no truncarlo mal. */
export function normalizarTelefono(valor: string) {
  let digitos = valor.replace(/\D/g, '')
  if (digitos.length > 9 && digitos.startsWith('56')) digitos = digitos.slice(2)
  return digitos.slice(0, 9)
}

export function telefonoValido(digitos: string) {
  return TELEFONO_CHILE.test(digitos)
}

/* 912345678 -> "+56 9 1234 5678". Los valores que no son un móvil de 9
   dígitos (pedidos antiguos con otro formato) se devuelven tal cual. */
export function formatearTelefono(valor: string) {
  return TELEFONO_CHILE.test(valor) ? `+56 9 ${valor.slice(1, 5)} ${valor.slice(5)}` : valor
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
