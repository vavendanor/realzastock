/* Lógica pura de src/lib/hojas.ts (sin base de datos).
   Correr desde la raíz:  node --import ./pruebas/registrar-ts.mjs pruebas/hojas/hojasLib.test.mjs */
const H = await import(new URL('../../src/lib/hojas.ts', import.meta.url).href)
const D = await import(new URL('../../src/lib/diasHabiles.ts', import.meta.url).href)

let ok = 0, fallos = 0
const chequeo = (n, c, d = '') => { c ? (ok++, console.log('  OK   ', n)) : (fallos++, console.log('  FALLA', n, d)) }
const sec = (t) => console.log(`\n== ${t}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

sec('Nombre sugerido y validación')
chequeo('nombreSugerido("2026-11-08") = "Hoja 08-11-2026"', H.nombreSugerido('2026-11-08') === 'Hoja 08-11-2026')
chequeo('nombre vacío o solo espacios: error', H.errorDeNombre('') !== null && H.errorDeNombre('    ') !== null)
chequeo('80 caracteres: válido; con espacios alrededor cuenta sin ellos', H.errorDeNombre('a'.repeat(80)) === null && H.errorDeNombre('  ' + 'a'.repeat(80) + '  ') === null)
chequeo('81 caracteres: error que dice cuántos tiene', /80/.test(H.errorDeNombre('a'.repeat(81)) ?? '') && /81/.test(H.errorDeNombre('a'.repeat(81)) ?? ''))
chequeo('topes iguales a los de la base de datos (300 pedidos, 80 caracteres)', H.MAX_PEDIDOS_POR_HOJA === 300 && H.MAX_NOMBRE_HOJA === 80)

sec('Número de pedido escrito a mano')
const nn = H.normalizarNumeroPedido
chequeo('"1280", " 1280 ", "#1280", " # 1280 " -> "1280"', ['1280', ' 1280 ', '#1280', ' # 1280 '].every((x) => nn(x) === '1280'))
chequeo('"T9001" (pedido de prueba) sirve', nn('T9001') === 'T9001')
chequeo('vacío, "#", "abc def", "12-80", "12 80", 21 caracteres: no sirven', ['', '   ', '#', 'abc def', '12-80', '12 80', '1'.repeat(21)].every((x) => nn(x) === null))

sec('Qué cuenta como pieza')
chequeo('mueble sí; cojín adicional sí; patas/ajuste adicional no', H.esPiezaFabricable({ esAdicional: false, tipo: 'SOFÁ' }) && H.esPiezaFabricable({ esAdicional: true, tipo: 'COJÍN' }) && !H.esPiezaFabricable({ esAdicional: true, tipo: 'PATAS' }) && !H.esPiezaFabricable({ esAdicional: true, tipo: null }))

sec('Resumen de un pedido')
const fila = (o) => ({ pedido_numero: '1300', fecha_pedido: '2026-10-20', tipo: 'SOFÁ', modelo: 'OSORNO', estado: 'por_fabricar', es_adicional: false, cancelado_en: null, ...o })
chequeo('sin filas o todo cancelado -> null (no se puede agregar)', H.resumirPedido([]) === null && H.resumirPedido([fila({ cancelado_en: '2026-10-21T00:00:00Z' })]) === null)
const r = H.resumirPedido([
  fila({}), fila({ tipo: 'POLTRONA', estado: 'fabricado', fecha_pedido: '2026-10-19' }),
  fila({ tipo: 'PATAS', modelo: null, es_adicional: true }), fila({ tipo: 'COJÍN', modelo: 'LINO', es_adicional: true }),
  fila({ cancelado_en: '2026-10-21T00:00:00Z', tipo: 'SOFÁ EN L' }),
])
chequeo('piezas: sofá, poltrona y cojín = 3; por fabricar = 2; fecha la más antigua', r.piezas === 3 && r.porFabricar === 2 && r.fechaPedido === '2026-10-19', JSON.stringify(r))
chequeo('modelos sin repetir ni vacíos', eq(r.modelos, ['SOFÁ OSORNO', 'POLTRONA OSORNO', 'COJÍN LINO']), JSON.stringify(r.modelos))
chequeo('descripción: "19-10-2026 · 3 piezas (2 por fabricar) · SOFÁ OSORNO, ..."', H.descripcionDeResumen(r) === '19-10-2026 · 3 piezas (2 por fabricar) · SOFÁ OSORNO, POLTRONA OSORNO, COJÍN LINO')

sec('Tarjetas de /hojas')
const cal = D.crearCalendario(['2026-10-12', '2026-10-31', '2026-11-01'])
const HOY = '2026-11-08'
const pz = (hoja, o = {}) => ({ hoja_id: hoja, estado: 'por_fabricar', es_pieza_fabricable: true, cancelado_en: null, fecha_pedido: '2026-10-01', plazo_desde: null, ...o })
const hojas = [
  { id: 'h1', nombre: 'A', creada_en: '2026-11-05T10:00:00Z' },
  { id: 'h2', nombre: 'B', creada_en: '2026-11-07T10:00:00Z' },
  { id: 'h3', nombre: 'C', creada_en: '2026-11-06T10:00:00Z' },
  { id: 'h4', nombre: 'D', creada_en: '2026-11-04T10:00:00Z' },
]
const piezas = [
  pz('h1'), pz('h1'), pz('h1'), pz('h1', { estado: 'fabricado' }),
  pz('h1', { es_pieza_fabricable: false }), pz('h1', { cancelado_en: '2026-10-25T00:00:00Z' }),
  pz('h2', { plazo_desde: '2026-11-02' }), pz('h4', { fecha_pedido: '2025-12-01' }), pz('hX'),
]
const t = H.construirTarjetas(hojas, new Map([['h1', 2], ['h2', 1], ['h4', 1]]), piezas, cal, HOY)
chequeo('orden: la más nueva primero (B, C, A, D)', t.map((x) => x.nombre).join() === 'B,C,A,D')
const A = t.find((x) => x.id === 'h1')
chequeo('A: 4 piezas que cuentan, 3 pendientes, 2 pedidos, avance 25 %', A.piezas === 4 && A.pendientes === 3 && A.pedidos === 2 && A.avance === 0.25, JSON.stringify(A))
chequeo('A: retraso máximo 11 días hábiles (25 transcurridos - plazo 14), calendario completo', A.retrasoMaximo === 11 && A.sinCalendario === false)
const B = t.find((x) => x.id === 'h2')
chequeo('B: con plazo reiniciado el 2-nov no hay retraso', B.retrasoMaximo === 0 && B.piezas === 1 && B.pendientes === 1 && B.avance === 0)
const C = t.find((x) => x.id === 'h3')
chequeo('C: hoja sin piezas ni pedidos: todo en 0 (sin dividir por cero)', C.piezas === 0 && C.pendientes === 0 && C.pedidos === 0 && C.avance === 0 && C.retrasoMaximo === 0)
chequeo('D: pedido de 2025 (sin feriados de 2025): avisa que el retraso puede no ser exacto', t.find((x) => x.id === 'h4').sinCalendario === true)
chequeo('las piezas de una hoja inexistente no aparecen en ninguna tarjeta', t.reduce((s, x) => s + x.piezas, 0) === 6)
const todoFab = H.construirTarjetas([hojas[0]], new Map([['h1', 1]]), [pz('h1', { estado: 'fabricado' }), pz('h1', { estado: 'en_despacho' }), pz('h1', { estado: 'entregado' })], cal, HOY)[0]
chequeo('todo fabricado/despachado/entregado: 100 %, 0 pendientes, sin retraso', todoFab.avance === 1 && todoFab.pendientes === 0 && todoFab.retrasoMaximo === 0)
const mezcla = H.construirTarjetas([hojas[0]], new Map(), [pz('h1', { fecha_pedido: '2026-11-03' }), pz('h1', { fecha_pedido: '2026-10-01' })], cal, HOY)[0]
chequeo('el retraso máximo es el de la pieza más atrasada (11), no el de la última', mezcla.retrasoMaximo === 11 && mezcla.pedidos === 0)

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
