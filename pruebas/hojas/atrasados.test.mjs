/* Alerta de piezas atrasadas del Dashboard (lógica pura). Correr desde la raíz:
   node --import ./pruebas/registrar-ts.mjs pruebas/hojas/atrasados.test.mjs */
import { piezasAtrasadas } from '../../src/lib/atrasados.ts'
import { calcularPlazo, crearCalendario, semaforoDelPlazo } from '../../src/lib/diasHabiles.ts'

let ok = 0, fallas = 0
const chequeo = (nombre, cond, detalle = '') => { if (cond) ok++; else { fallas++; console.log(`  FALLA ${nombre} ${detalle}`) } }
const sec = (t) => console.log(`\n== ${t}`)

/* Feriados de octubre y noviembre de 2026 (los que cuentan para estas fechas). */
const cal = crearCalendario(['2026-10-12', '2026-10-31', '2026-11-01'])
let n = 0
const orden = (extra = {}) => ({
  id: `id-${++n}`, numero: `${1000 + n}`, pedidoNumero: `${1000 + n}`, tipo: 'SOFÁ', modelo: 'Venecia', comuna: 'Providencia',
  fechaPedido: '2026-10-01', plazoDesde: null, estado: 'por_fabricar', canceladoEn: null, esAdicional: false, ...extra,
})
const dias = (lista, hoy) => piezasAtrasadas(lista, cal, hoy).piezas.map((p) => `${p.numero}:${p.dias}`).join(',')

sec('La cuenta de días (hecha a mano)')
// Pedido del 1-oct, corte 30-oct: hábiles del 2 al 30 = 1 (2-oct) + 5 + 4 (12-oct feriado) + 5 + 5 = 20 -> 6 de atraso.
chequeo('1-oct a 30-oct: 20 días hábiles, 6 de atraso', calcularPlazo('2026-10-01', '2026-10-30', cal).retraso === 6)
const a = orden({ numero: 'A' })
chequeo('una pieza pasada del plazo sale con sus días de atraso (6)', dias([a], '2026-10-30') === 'A:6', dias([a], '2026-10-30'))
// Pedido del 20-oct: al 9-nov van 14 días hábiles (vence hoy, amarillo); al 10-nov, 15 (1 de atraso).
const b = orden({ numero: 'B', fechaPedido: '2026-10-20' })
chequeo('14 días hábiles (vence hoy) NO es atraso', dias([b], '2026-11-09') === '', dias([b], '2026-11-09'))
chequeo('15 días hábiles: 1 día de atraso', dias([b], '2026-11-10') === 'B:1', dias([b], '2026-11-10'))
chequeo('el semáforo es el de siempre: rojo "Atrasado 1 día"', semaforoDelPlazo(calcularPlazo('2026-10-20', '2026-11-10', cal)).texto === 'Atrasado 1 día')
chequeo('un pedido nuevo (en plazo) no aparece', dias([orden({ numero: 'N', fechaPedido: '2026-10-29' })], '2026-10-30') === '')

sec('Qué piezas cuentan')
chequeo('una pieza ya fabricada no está atrasada', dias([orden({ numero: 'F', estado: 'fabricado' })], '2026-10-30') === '')
chequeo('en despacho y entregadas tampoco', dias([orden({ estado: 'en_despacho' }), orden({ estado: 'entregado' })], '2026-10-30') === '')
chequeo('una cancelada no cuenta', dias([orden({ canceladoEn: '2026-10-05T00:00:00Z' })], '2026-10-30') === '')
chequeo('un adicional que no es cojín (ej. almohadón) no cuenta; un cojín adicional sí', dias([orden({ numero: 'X', esAdicional: true, tipo: 'ALMOHADÓN' }), orden({ numero: 'C', esAdicional: true, tipo: 'COJÍN' })], '2026-10-30') === 'C:6', dias([orden({ numero: 'X', esAdicional: true, tipo: 'ALMOHADÓN' }), orden({ numero: 'C', esAdicional: true, tipo: 'COJÍN' })], '2026-10-30'))
chequeo('si el plazo se fijó desde otra fecha (plazoDesde), se cuenta desde ahí', dias([orden({ numero: 'P', plazoDesde: '2026-10-29' })], '2026-10-30') === '' && dias([orden({ numero: 'P', plazoDesde: '2026-10-05' })], '2026-10-30') === 'P:4', dias([orden({ numero: 'P', plazoDesde: '2026-10-05' })], '2026-10-30'))

sec('Orden y datos de cada fila')
const lista = [
  orden({ numero: '1300', pedidoNumero: '1300', fechaPedido: '2026-10-08' }),
  orden({ numero: '1100', pedidoNumero: '1100', fechaPedido: '2026-10-01' }),
  orden({ numero: '1250-2', pedidoNumero: '1250', fechaPedido: '2026-10-05' }),
  orden({ numero: '1250-1', pedidoNumero: '1250', fechaPedido: '2026-10-05' }),
  orden({ numero: '1200', pedidoNumero: '1200', fechaPedido: '2026-10-05' }),
]
const r = piezasAtrasadas(lista, cal, '2026-10-30')
chequeo('de la más atrasada a la menos', JSON.stringify(r.piezas.map((p) => p.dias)) === JSON.stringify([...r.piezas.map((p) => p.dias)].sort((x, y) => y - x)) && r.piezas[0].numero === '1100' && r.piezas.at(-1).numero === '1300', r.piezas.map((p) => `${p.numero}:${p.dias}`).join(','))
chequeo('a igual atraso, por N° de pedido y de mueble (1200, 1250-1, 1250-2)', r.piezas.slice(1, 4).map((p) => p.numero).join(',') === '1200,1250-1,1250-2', r.piezas.map((p) => p.numero).join(','))
chequeo('cada fila trae pedido, modelo, comuna y días', ['numero', 'pedido', 'modelo', 'comuna', 'dias'].every((k) => k in r.piezas[0]) && r.piezas[0].comuna === 'Providencia' && r.piezas[0].modelo.includes('VENECIA'), JSON.stringify(r.piezas[0]))
chequeo('sin nombre de cliente ni datos personales (solo esos campos)', Object.keys(r.piezas[0]).sort().join() === 'comuna,dias,id,modelo,numero,pedido', Object.keys(r.piezas[0]).join())
chequeo('una comuna vacía se muestra como "—"', piezasAtrasadas([orden({ comuna: null })], cal, '2026-10-30').piezas[0].comuna === '—')
chequeo('sin piezas atrasadas, la lista está vacía', piezasAtrasadas([], cal, '2026-10-30').piezas.length === 0)

sec('Calendario incompleto')
chequeo('con feriados de 2026 cargados no avisa', piezasAtrasadas([a], cal, '2026-10-30').sinCalendario === false)
chequeo('si falta el calendario de un año, lo avisa', piezasAtrasadas([orden({ fechaPedido: '2025-12-01' })], cal, '2026-10-30').sinCalendario === true)

console.log(`\n${ok} comprobaciones OK, ${fallas} fallas`)
process.exit(fallas ? 1 : 0)
