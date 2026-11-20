/* Excel de la hoja de fabricación: reglas de cada celda, semáforo del plazo, y el archivo .xlsx releído
   celda por celda contra el formato de "archivos de contexto/Lista Pendiente 31-10-26.xlsx".
   Correr desde la raíz del proyecto:  node --import ./pruebas/registrar-ts.mjs pruebas/hojas/excelHoja.test.mjs */
import ExcelJS from 'exceljs'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
const E = await import(new URL('../../src/lib/excelHoja.ts', import.meta.url).href)
const D = await import(new URL('../../src/lib/diasHabiles.ts', import.meta.url).href)
const O = await import(new URL('../../src/lib/ordenes.ts', import.meta.url).href)
const V = await import(new URL('../../src/lib/vistasDeHoja.ts', import.meta.url).href)

let ok = 0, fallos = 0
const chequeo = (n, c, d = '') => { c ? (ok++, console.log('  OK   ', n)) : (fallos++, console.log('  FALLA', n, d)) }
const sec = (t) => console.log(`\n== ${t}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---------- Reglas de cada dato ---------- */
sec('Modelo, medida, lado, tela, dirección, patas')
const mod = E.modeloDeLista
chequeo('SOFÁ OSORNO, POL. CHILLÁN, L VALENCIA, SOFÁ CAMA MENDOZA', mod({ tipo: 'SOFÁ', modelo: 'OSORNO' }) === 'SOFÁ OSORNO' && mod({ tipo: 'POLTRONA', modelo: 'CHILLÁN' }) === 'POL. CHILLÁN' && mod({ tipo: 'SOFÁ EN L', modelo: 'VALENCIA' }) === 'L VALENCIA' && mod({ tipo: 'SOFÁ CAMA', modelo: 'MENDOZA' }) === 'SOFÁ CAMA MENDOZA')
chequeo('cojín: "COJIN 91X105X10" -> "COJÍN 91X105X10"', mod({ tipo: 'COJÍN', modelo: 'COJIN 91X105X10' }) === 'COJÍN 91X105X10')
const med = E.medidaDeLista
chequeo('medidas: 175 cm -> 175; 220 cm x 150 cm -> 220X150; ESTÁNDAR/null -> vacío', med('175 cm').medida === '175' && med('220 cm x 150 cm').medida === '220X150' && med('ESTÁNDAR').medida === '' && med(null).medida === '' && med('215 cm x 170 cm').medida === '215X170')
chequeo('"190cm Confort Size - Colchón Full" -> 190 y el resto sale aparte', eq(med('190cm Confort Size - Colchón Full'), { medida: '190', extra: 'CONFORT SIZE - COLCHÓN FULL' }) && med('145cm Mini - Colchón 1P').extra === 'MINI - COLCHÓN 1P')
chequeo('lado: izquierda/derecha con mayúscula inicial; ninguna -> vacío', E.ladoDeLista('izquierda') === 'Izquierda' && E.ladoDeLista('derecha') === 'Derecha' && E.ladoDeLista('ninguna') === '' && E.ladoDeLista(null) === '')
const tela = E.telaDeLista
chequeo('tela: LINO + color; CUERO + color con tilde (CAFE -> CAFÉ, MARRON -> MARRÓN)', tela({ tela: 'LINO HIDROREPELENTE', color: 'CRUDO' }) === 'LINO CRUDO' && tela({ tela: 'CUERO BLEND', color: 'CAFE CLARO' }) === 'CUERO CAFÉ CLARO' && tela({ tela: 'CUERO BLEND', color: 'MARRON' }) === 'CUERO MARRÓN' && tela({ tela: 'LINO HIDROREPELENTE', color: 'AZUL MARINO' }) === 'LINO AZUL MARINO')
chequeo('tela: sin datos -> vacío (sin "null")', tela({ tela: null, color: null }) === '')
const dir = E.direccionDeLista
chequeo('dirección: comuna en mayúsculas; RETIRO TIENDA -> RETIRO; sin dirección -> SIN DIRECCIÓN', dir('Ñuñoa') === 'ÑUÑOA' && dir('RETIRO TIENDA') === 'RETIRO' && dir('NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO') === 'SIN DIRECCIÓN' && dir(null) === 'SIN DIRECCIÓN' && dir('  ') === 'SIN DIRECCIÓN')
const patas = E.patasDeLista
chequeo('patas: PREDETERMINADAS; "VER NOTAS" si la nota las menciona; el valor propio si lo hay', patas({ esAdicional: false, notasProduccion: null, patas: 'PREDETERMINADAS' }) === 'PREDETERMINADAS' && patas({ esAdicional: false, notasProduccion: 'Patas metálicas negras', patas: 'PREDETERMINADAS' }) === 'VER NOTAS' && patas({ esAdicional: false, notasProduccion: 'patas', patas: 'CÓNICAS' }) === 'CÓNICAS')
const comp = E.composicionDelPedido
const p = (tipo, extra = {}) => ({ tipo, esAdicional: false, canceladoEn: null, ...extra })
chequeo('composición: 1 SOFÁ + 1 POLTRONA; 1 SOFÁ + 2 POLTRONAS; 2 SOFÁS; con cojín', comp([p('SOFÁ'), p('POLTRONA')]) === 'PEDIDO DE 1 SOFÁ + 1 POLTRONA' && comp([p('SOFÁ'), p('POLTRONA'), p('POLTRONA')]) === 'PEDIDO DE 1 SOFÁ + 2 POLTRONAS' && comp([p('SOFÁ'), p('SOFÁ EN L')]) === 'PEDIDO DE 2 SOFÁS' && comp([p('SOFÁ'), p('COJÍN', { esAdicional: true }), p('COJÍN', { esAdicional: true })]) === 'PEDIDO DE 1 SOFÁ + 2 COJINES')
chequeo('composición: una sola pieza -> nada; no cuenta patas ni canceladas', comp([p('SOFÁ')]) === null && comp([p('SOFÁ'), p(null, { esAdicional: true })]) === null && comp([p('SOFÁ'), p('POLTRONA', { canceladoEn: '2026-10-01T00:00:00Z' })]) === null)

/* ---------- Semáforo del plazo ---------- */
sec('Semáforo del plazo (verde, amarillo, rojo)')
const sem = D.semaforoDelPlazo
const verdes = [14, 13, 9, 5, 4].every((f) => sem({ faltantes: f, retraso: 0 }).color === 'verde' && sem({ faltantes: f, retraso: 0 }).texto === `Faltan ${f} días`)
chequeo('en plazo (quedan 4 días o más): verde, "Faltan N días"', verdes, JSON.stringify([14, 4].map((f) => sem({ faltantes: f, retraso: 0 }))))
chequeo('últimos 3 días: amarillo, "Faltan 3 días", "Faltan 2 días" y "Falta 1 día"', eq(sem({ faltantes: 3, retraso: 0 }), { color: 'amarillo', dias: 3, texto: 'Faltan 3 días' }) && sem({ faltantes: 2, retraso: 0 }).texto === 'Faltan 2 días' && eq(sem({ faltantes: 1, retraso: 0 }), { color: 'amarillo', dias: 1, texto: 'Falta 1 día' }))
chequeo('el último día (faltan 0): amarillo, "Vence hoy"', eq(sem({ faltantes: 0, retraso: 0 }), { color: 'amarillo', dias: 0, texto: 'Vence hoy' }))
chequeo('atrasado: rojo, "Atrasado 1 día" y "Atrasado 4 días"', eq(sem({ faltantes: 0, retraso: 1 }), { color: 'rojo', dias: 1, texto: 'Atrasado 1 día' }) && eq(sem({ faltantes: 0, retraso: 4 }), { color: 'rojo', dias: 4, texto: 'Atrasado 4 días' }))
chequeo('el aviso amarillo empieza a los 3 días', D.DIAS_AVISO_PLAZO === 3 && D.PLAZO_FABRICACION_DIAS === 14)

/* ---------- Filas ---------- */
sec('Filas de una hoja (casos a mano)')
const cal = D.crearCalendario(['2026-10-12', '2026-10-31', '2026-11-01'])
const HOY = '2026-11-08'
let n = 0
const orden = (o) => O.aplanarOrden({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, numero: '1000', pedido_numero: '1000', shopify_order_id: 'gid://x/1', tipo: 'SOFÁ', modelo: 'OSORNO', orientacion: 'ninguna', cm: '170 cm', color: 'CRUDO', tela: 'LINO HIDROREPELENTE',
  region: 'Metropolitana de Santiago', comuna: 'Ñuñoa', comuna_revisar: false, patas: 'PREDETERMINADAS', fecha_pedido: '2026-10-20', plazo_desde: null, titulo_shopify: null, es_adicional: false, etapa_b: false, etapa_i: false, etapa_a: false, etapa_c: false,
  listo: false, listo_en: null, estado: 'por_fabricar', cancelado_en: null, notas_produccion: null, origen: 'manual_shopify', origen_shopify: 'pos', despachado_en: null, actualizado_en: '2026-10-20T00:00:00Z', pedido_creado_en: '2026-10-20T15:00:00Z', shopify_preparado: false, listo_origen: null, ...o,
})
/* Días hábiles contados aparte de la app (lun-vie sin feriados, desde el día siguiente al inicio). */
const FER = new Set(['2026-10-12', '2026-10-31', '2026-11-01'])
function habiles(inicio, fin) {
  let k = 0
  const d = new Date(`${inicio}T12:00:00Z`)
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1)
    const s = d.toISOString().slice(0, 10)
    if (s > fin) return k
    const dia = d.getUTCDay()
    if (dia !== 0 && dia !== 6 && !FER.has(s)) k++
  }
}
function inicioParaT(t) {
  const d = new Date(`${HOY}T12:00:00Z`)
  for (let i = 0; i < 120; i++) {
    d.setUTCDate(d.getUTCDate() - 1)
    const s = d.toISOString().slice(0, 10)
    if (habiles(s, HOY) === t) return s
  }
  throw new Error('sin inicio para ' + t)
}
const baseVistas = [
  orden({ numero: '1000-1', pedido_numero: '1000', tipo: 'SOFÁ', modelo: 'OSORNO', cm: '190 cm', etapa_b: true }),
  orden({ numero: '1000-2', pedido_numero: '1000', tipo: 'POLTRONA', modelo: 'OSORNO', cm: 'ESTÁNDAR', notas_produccion: 'patas metálicas' }),
  orden({ numero: '1000-3', pedido_numero: '1000', tipo: 'POLTRONA', modelo: 'OSORNO', estado: 'fabricado', listo: true, etapa_b: true, etapa_i: true, etapa_a: true, etapa_c: true }),
  orden({ numero: '1000-4', pedido_numero: '1000', tipo: null, modelo: 'PATAS METALICAS', es_adicional: true }), // adicional: no es pieza
  orden({ numero: '1000-5', pedido_numero: '1000', tipo: 'SOFÁ', cancelado_en: '2026-10-25T00:00:00Z' }), // cancelada
  orden({ numero: '999', pedido_numero: '999', shopify_order_id: 'gid://x/2', comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO', fecha_pedido: '2026-11-02', region: null }),
  orden({ numero: '1100', pedido_numero: '1100', shopify_order_id: 'gid://x/3', tipo: 'SOFÁ CAMA', modelo: 'MENDOZA', cm: '190cm Confort Size - Colchón Full', comuna: 'RETIRO TIENDA', fecha_pedido: '2026-10-01', plazo_desde: '2026-11-02', notas_produccion: 'gris medio' }),
  orden({ numero: '1200', pedido_numero: '1200', shopify_order_id: 'gid://x/4', tipo: 'COJÍN', modelo: 'COJIN 91X105X10', cm: null, es_adicional: true, fecha_pedido: '2026-10-01' }),
  orden({ numero: 'T9001', pedido_numero: 'T9001', shopify_order_id: 'gid://x/5', fecha_pedido: '2026-11-06' }),
]
const terminadas = [
  orden({ numero: '1300', pedido_numero: '1300', shopify_order_id: 'gid://x/6', estado: 'en_despacho', listo: true, etapa_b: true, etapa_i: true, etapa_a: true, etapa_c: true, despachado_en: '2026-11-05T12:00:00Z' }),
  orden({ numero: '1301', pedido_numero: '1301', shopify_order_id: 'gid://x/7', estado: 'entregado', listo: false, etapa_b: true }), // entregada con LISTO sin marcar: igual sale con LISTO
]
/* Piezas por fabricar con cada color del semáforo: t = 5 (faltan 9), 10 (faltan 4), 11 (faltan 3), 12 (faltan 2), 14 (vence hoy), 17 (atrasado 3). */
const casosSemaforo = [[2000, 5, 'verde'], [2001, 10, 'verde'], [2002, 11, 'amarillo'], [2003, 12, 'amarillo'], [2004, 14, 'amarillo'], [2005, 17, 'rojo']]
const semaforoPiezas = casosSemaforo.map(([ped, t]) => orden({ numero: String(ped), pedido_numero: String(ped), shopify_order_id: `gid://x/${ped}`, fecha_pedido: inicioParaT(t) }))
const canceladoTodo = orden({ numero: '777', pedido_numero: '777', shopify_order_id: 'gid://x/9', cancelado_en: '2026-10-30T00:00:00Z' })
const todasLasOrdenes = [...baseVistas, ...terminadas, ...semaforoPiezas, canceladoTodo]
const datos = E.construirFilasHoja(todasLasOrdenes, cal, HOY)
chequeo('salen TODAS las piezas de la hoja: 15 piezas de 13 pedidos (no el adicional, ni la cancelada, ni el pedido cancelado)', datos.piezas === 15 && datos.pedidos === 13, `${datos.piezas}/${datos.pedidos}`)
chequeo('de ellas, 12 siguen por fabricar y 3 están terminadas', datos.porFabricar === 12 && datos.filas.filter((f) => f.terminada).length === 3)
const ped = (x) => datos.filas.filter((f) => f.pedido === x)
chequeo('orden por pedido: 999, 1000 (x3), 1100, 1200, 1300, 1301, 2000...2005, T9001', eq(datos.filas.map((f) => f.pedido), ['999', '1000', '1000', '1000', '1100', '1200', '1300', '1301', '2000', '2001', '2002', '2003', '2004', '2005', 'T9001']), datos.filas.map((f) => f.pedido).join())
const fab = ped('1000').find((f) => f.unidad === 3)
chequeo('la poltrona ya fabricada sale, terminada, con sus 4 etapas y LISTO marcados', fab.terminada && fab.b && fab.i && fab.a && fab.c && fab.listo)
chequeo('en las piezas terminadas los días hábiles y el semáforo van vacíos', [fab, ...ped('1300'), ...ped('1301')].every((f) => f.terminada && f.transcurridos === null && f.faltantes === null && f.retraso === null && f.plazo === null))
chequeo('en despacho y entregada: LISTO marcado aunque la base no lo tenga (1301) y cualquier etapa marcada sale', ped('1300')[0].listo && ped('1301')[0].listo && ped('1301')[0].b && !ped('1301')[0].i)
chequeo('la poltrona por fabricar lleva "VER NOTAS" y su nota; el sofá, patas predeterminadas', ped('1000').find((f) => f.unidad === 2).patas === 'VER NOTAS' && ped('1000').find((f) => f.unidad === 1).patas === 'PREDETERMINADAS')
chequeo('"PEDIDO DE 1 SOFÁ + 2 POLTRONAS" en las tres piezas del 1000 (cuenta la fabricada, no la cancelada)', ped('1000').every((f) => f.notas.includes('PEDIDO DE 1 SOFÁ + 2 POLTRONAS')), JSON.stringify(ped('1000').map((f) => f.notas)))
chequeo('la nota original va antes que la composición, separadas por " / "', ped('1000').find((f) => f.unidad === 2).notas === 'patas metálicas / PEDIDO DE 1 SOFÁ + 2 POLTRONAS')
chequeo('el pedido 999 sin dirección: "SIN DIRECCIÓN" y región vacía', ped('999')[0].direccion === 'SIN DIRECCIÓN' && ped('999')[0].region === '')
chequeo('el sofá cama: medida 190, RETIRO, y lo que sobra de la medida pasa a las notas', ped('1100')[0].medida === '190' && ped('1100')[0].direccion === 'RETIRO' && ped('1100')[0].notas === 'gris medio / CONFORT SIZE - COLCHÓN FULL', ped('1100')[0].notas)
chequeo('el cojín cuenta como pieza, con su nombre', ped('1200').length === 1 && ped('1200')[0].modelo === 'COJÍN 91X105X10' && ped('1200')[0].medida === '')
/* Del 20-oct: oct 21,22,23 (3) + 26-30 (5; el 12 queda fuera) + nov 2-6 (5) = 13; el 8-nov es domingo. */
chequeo('días hábiles del 20-oct al 8-nov = 13: faltan 1 (amarillo), sin retraso', ped('1000')[0].transcurridos === 13 && ped('1000')[0].faltantes === 1 && ped('1000')[0].retraso === 0 && ped('1000')[0].plazo.color === 'amarillo' && ped('1000')[0].plazo.texto === 'Falta 1 día', JSON.stringify(ped('1000')[0]))
/* Del 1-oct: 25 hábiles (el 12-oct es feriado), 14 de plazo. */
chequeo('1200 (pedido del 1-oct): 25 hábiles, atrasado 11 días (rojo); 1100 con plazo fijado el 2-nov: 4 hábiles, faltan 10 (verde)', ped('1200')[0].transcurridos === 25 && ped('1200')[0].plazo.texto === 'Atrasado 11 días' && ped('1100')[0].transcurridos === 4 && ped('1100')[0].plazo.texto === 'Faltan 10 días' && ped('1100')[0].plazo.color === 'verde')
chequeo('los casos del semáforo dan el color y texto esperados (verde, verde, amarillo, amarillo, vence hoy, rojo)', eq(casosSemaforo.map(([x]) => ped(String(x))[0].plazo.color), ['verde', 'verde', 'amarillo', 'amarillo', 'amarillo', 'rojo']) && eq(casosSemaforo.map(([x]) => ped(String(x))[0].plazo.texto), ['Faltan 9 días', 'Faltan 4 días', 'Faltan 3 días', 'Faltan 2 días', 'Vence hoy', 'Atrasado 3 días']), JSON.stringify(casosSemaforo.map(([x]) => ped(String(x))[0].plazo)))
chequeo('calendario completo: sin aviso; sin calendario del año: se avisa', datos.sinCalendario === false && E.construirFilasHoja(baseVistas, D.crearCalendario([]), HOY).sinCalendario === true)
chequeo('subtítulo: "Actualizado al 08-11-2026 · 13 pedidos · 15 piezas · 12 por fabricar · plazo máximo de fabricación: 14 días hábiles"', E.subtituloDeHoja(datos, HOY) === 'Actualizado al 08-11-2026 · 13 pedidos · 15 piezas · 12 por fabricar · plazo máximo de fabricación: 14 días hábiles', E.subtituloDeHoja(datos, HOY))
chequeo('subtítulo en singular: "1 pedido · 1 pieza"', /· 1 pedido · 1 pieza · 1 por fabricar ·/.test(E.subtituloDeHoja({ pedidos: 1, piezas: 1, porFabricar: 1 }, HOY)))
chequeo('hoja solo con pedidos cancelados: sin piezas', E.construirFilasHoja([canceladoTodo], cal, HOY).piezas === 0)
chequeo('nombre del archivo: "Hoja de fabricación - <hoja> dd-mm-aa.xlsx" sin caracteres prohibidos', E.nombreArchivoHoja('Lote: A/B?', HOY) === 'Hoja de fabricación - Lote A B 08-11-26.xlsx', E.nombreArchivoHoja('Lote: A/B?', HOY))

/* ---------- Agrupaciones de la pantalla ---------- */
sec('Agrupación de la pantalla (por pedido)')
const gp = V.agruparPorPedido(baseVistas, ['1000', '999', '1100', '1200', 'T9001', '5555'])
chequeo('por pedido: orden numérico y el pedido sin piezas queda marcado', eq(gp.map((g) => g.pedido), ['999', '1000', '1100', '1200', '5555', 'T9001']) && gp.find((g) => g.pedido === '5555').cancelado === true && gp.find((g) => g.pedido === '5555').piezas.length === 0)
chequeo('las piezas visibles del 1000 son 3 (sofá y 2 poltronas; sin adicional ni cancelada) y la fecha es la del pedido', gp.find((g) => g.pedido === '1000').piezas.length === 3 && gp.find((g) => g.pedido === '1000').fechaPedido === '2026-10-20')
chequeo('el inicio del plazo fijado a mano se ve (1100)', gp.find((g) => g.pedido === '1100').plazoDesde === '2026-11-02' && gp.find((g) => g.pedido === '1000').plazoDesde === null)
chequeo('un pedido con todo cancelado se marca "cancelado"', V.agruparPorPedido([canceladoTodo], ['777'])[0].cancelado === true)
chequeo('resumen: 5 pedidos, 7 piezas (con la fabricada) y 6 por fabricar', eq(V.resumirHoja(baseVistas, ['1000', '999', '1100', '1200', 'T9001']), { pedidos: 5, piezas: 7, pendientes: 6 }))
chequeo('ya no existen las agrupaciones por modelo', V.agruparPorModelo === undefined && E.agruparPorModelo === undefined && E.compararMedida === undefined)

/* ---------- El archivo .xlsx ---------- */
sec('Archivo generado: una sola hoja, releída celda por celda')
const referencia = `${RAIZ}archivos de contexto/Lista Pendiente 31-10-26.xlsx`
const ref = new ExcelJS.Workbook()
await ref.xlsx.readFile(referencia)
const rh = ref.worksheets[0]
const buf = await E.generarLibroHoja(datos, HOY)
const gen = new ExcelJS.Workbook()
await gen.xlsx.load(buf)
chequeo('una sola hoja, llamada "Hoja de fabricación"', gen.worksheets.length === 1 && gen.worksheets[0].name === 'Hoja de fabricación', gen.worksheets.map((w) => w.name).join('|'))
const g = gen.worksheets[0]

const firma = (c) => JSON.stringify({
  fill: c.fill?.fgColor?.argb ?? null,
  font: c.font ? { b: !!c.font.bold, i: !!c.font.italic, s: c.font.size, n: c.font.name, c: c.font.color?.argb ?? null } : null,
  al: c.alignment ? { h: c.alignment.horizontal ?? null, v: c.alignment.vertical ?? null, w: !!c.alignment.wrapText } : null,
  bd: ['top', 'left', 'bottom', 'right'].map((l) => (c.border?.[l] ? `${c.border[l].style}${c.border[l].color?.argb ?? ''}` : '')).join(','),
})
const firmaDeFila = (ws, fila) => Array.from({ length: 17 }, (_, i) => firma(ws.getRow(fila).getCell(i + 1)))
const textos = (ws, fila) => Array.from({ length: 17 }, (_, i) => { const v = ws.getRow(fila).getCell(i + 1).value; return v === null || v === undefined ? '' : String(v) })

chequeo('anchos de las columnas iguales a la referencia', eq(g.columns.map((c) => c.width ?? null).slice(0, 16), rh.columns.map((c) => c.width ?? null).slice(0, 16)))
chequeo('alto del título (24.95) y del encabezado (45)', g.getRow(1).height === rh.getRow(1).height && g.getRow(3).height === rh.getRow(3).height)
chequeo('título y subtítulo combinados A1:L1 y A2:L2', ['A1:L1', 'A2:L2'].every((m) => g.model.merges.includes(m)) && g.model.merges.length === 2)
chequeo('título: "HOJA DE FABRICACIÓN — ORDENADA POR Nº DE PEDIDO" (ya no dice "PEDIDOS PENDIENTES")', g.getCell('A1').value === 'HOJA DE FABRICACIÓN — ORDENADA POR Nº DE PEDIDO' && !/PENDIENTE/i.test(String(g.getCell('A1').value)))
chequeo('título, subtítulo y encabezado con el mismo estilo que la referencia', eq([firma(g.getCell('A1')), firma(g.getCell('A2'))], [firma(rh.getCell('A1')), firma(rh.getCell('A2'))]) && eq(firmaDeFila(g, 3), firmaDeFila(rh, 3)))
chequeo('encabezado de 17 columnas igual al de la referencia', eq(textos(g, 3), textos(rh, 3)))
chequeo('subtítulo con fecha, pedidos, piezas y "por fabricar"', g.getCell('A2').value === 'Actualizado al 08-11-2026 · 13 pedidos · 15 piezas · 12 por fabricar · plazo máximo de fabricación: 14 días hábiles', String(g.getCell('A2').value))
chequeo('encabezado fijo (A4), zoom 90', g.views[0].state === 'frozen' && g.views[0].ySplit === 3 && g.views[0].topLeftCell === 'A4' && g.views[0].zoomScale === 90)
chequeo('horizontal, ajustada a 1 página de ancho, mismos márgenes', g.pageSetup.orientation === 'landscape' && g.pageSetup.fitToPage === true && g.pageSetup.fitToWidth === 1 && g.pageSetup.fitToHeight === 0 && eq(g.pageSetup.margins, rh.pageSetup.margins))
chequeo('autofiltro sobre el encabezado y las 15 filas (A3:Q18)', g.autoFilter === 'A3:Q18', JSON.stringify(g.autoFilter))
chequeo('15 filas de datos (4 a 18)', g.rowCount === 18, String(g.rowCount))

const COL = { verde: ['FFC6EFCE', 'FF006100'], amarillo: ['FFFFEB9C', 'FF9C5700'], rojo: ['FFFFC7CE', 'FF9C0006'] }
const refBlanca = rh.getRow(4), refGris = rh.getRow(5)
let todoOk = true, detalle = ''
const malo = (cond, d) => { if (!cond) { todoOk = false; detalle += d + ' ' } }
let ultimo = '', relleno = 'FFF2F2F2'
datos.filas.forEach((f, i) => {
  const r = 4 + i
  const fila = g.getRow(r)
  const t = textos(g, r)
  const nuevo = f.pedido !== ultimo
  if (nuevo) relleno = relleno === 'FFF2F2F2' ? 'FFFFFFFF' : 'FFF2F2F2'
  ultimo = f.pedido
  malo(t[0] === (nuevo ? f.pedido : ''), `A${r}`)
  malo(nuevo ? (!/^\d+$/.test(f.pedido) || typeof fila.getCell(1).value === 'number') : fila.getCell(1).value === null, `Atipo${r}`)
  malo(eq(t.slice(1, 8), [f.modelo, f.medida, f.lado, f.tela, f.direccion, f.region, f.patas]), `texto${r}`)
  malo(t[11] === f.notas, `notas${r}`)
  if (f.terminada) malo(eq(t.slice(8, 11), ['', '', '']) && [9, 10, 11].every((c) => fila.getCell(c).value === null), `dias-vacios${r}`)
  else malo(eq(t.slice(8, 11), [String(f.transcurridos), String(f.faltantes), f.retraso ? String(f.retraso) : '']) && [9, 10].every((c) => typeof fila.getCell(c).value === 'number') && (f.retraso ? typeof fila.getCell(11).value === 'number' : fila.getCell(11).value === null), `dias${r}`)
  malo(eq(t.slice(12), [f.b ? 'X' : '', f.i ? 'X' : '', f.a ? 'X' : '', f.c ? 'X' : '', f.listo ? 'X' : '']), `marcas${r}`)
  const modelo = relleno === 'FFFFFFFF' ? refBlanca : refGris
  for (let c = 1; c <= 17; c++) {
    /* Faltantes lleva el color del plazo; Retraso solo se pinta (de rojo) si hay retraso: sin retraso la celda va vacía y sin color. */
    if (!f.terminada && (c === 10 || (c === 11 && f.retraso > 0))) {
      const [fondo, letra] = COL[f.plazo.color]
      const celda = fila.getCell(c)
      malo(celda.fill.fgColor.argb === fondo && celda.font.color.argb === letra && celda.font.bold === true && celda.font.size === 10, `color-plazo ${celda.address}`)
    } else {
      /* En la referencia la columna de retraso va en rojo y negrita; en una pieza terminada no lleva color. */
      const esperado = c === 11 ? firma(modelo.getCell(11)).replace('"b":true', '"b":false').replace('"c":"FFC00000"', '"c":null') : firma(modelo.getCell(c))
      malo(firma(fila.getCell(c)) === esperado, `estilo ${fila.getCell(c).address}`)
    }
  }
})
chequeo('cada celda de las 15 filas (texto, números, marcas y estilo) coincide con lo esperado y con la referencia', todoOk, detalle.slice(0, 600))
chequeo('piezas terminadas: LISTO con "X" (columna Q) y días vacíos', ['1000', '1300', '1301'].length === 3 && datos.filas.every((f, i) => !f.terminada || (g.getRow(4 + i).getCell(17).value === 'X' && g.getRow(4 + i).getCell(9).value === null)))
chequeo('verde, amarillo y rojo en la celda de Faltantes de las piezas por fabricar', casosSemaforo.every(([x, , color]) => { const i = datos.filas.findIndex((f) => f.pedido === String(x)); return g.getRow(4 + i).getCell(10).fill.fgColor.argb === COL[color][0] }))
chequeo('la celda de Retraso queda VACÍA y sin color cuando no hay retraso, y roja con retraso real', datos.filas.every((f, i) => {
  const c = g.getRow(4 + i).getCell(11)
  if (!f.terminada && f.retraso > 0) return c.value === f.retraso && c.fill.fgColor.argb === COL.rojo[0] && c.font.color.argb === COL.rojo[1] && c.font.bold === true
  return c.value === null && c.font.color?.argb !== COL.rojo[1] && !['FFC6EFCE', 'FFFFEB9C', 'FFFFC7CE'].includes(c.fill.fgColor.argb)
}))
chequeo('el número de pedido solo en la primera fila de cada pedido (el 1000 tiene 3 filas)', g.getCell('A5').value === 1000 && g.getCell('A6').value === null && g.getCell('A7').value === null && g.getCell('A4').value === 999)
chequeo('zebra por pedido: 999 blanco, 1000 gris en sus 3 filas, 1100 blanco', ['FFFFFFFF', 'FFF2F2F2', 'FFF2F2F2', 'FFF2F2F2', 'FFFFFFFF'].every((c, i) => g.getRow(4 + i).getCell(1).fill.fgColor.argb === c))
const todo = []
g.eachRow((row) => row.eachCell((c) => todo.push(String(c.value ?? ''))))
chequeo('el archivo no contiene RUT, correos ni teléfonos', !todo.some((t) => /\brut\b|@|\+56|\b\d{7,8}-[\dkK]\b/i.test(t)))
chequeo('el archivo ya no trae la hoja "Pedidos por Modelo y Medidas" ni el texto "Pedidos Pendientes"', !gen.worksheets.some((w) => /Modelo y Medidas|Pendientes/i.test(w.name)) && !todo.some((t) => /Pedidos Pendientes|PEDIDOS PENDIENTES/.test(t)))

/* ---------- Octubre 2026 (solo si están los datos reales en pruebas/arnes/datos.json) ---------- */
const rutaDatos = new URL('../arnes/datos.json', import.meta.url)
if (existsSync(fileURLToPath(rutaDatos))) {
  sec('Octubre 2026: la hoja generada con los datos reales vs la lista del taller (31-10-26)')
  const oct = JSON.parse(readFileSync(fileURLToPath(rutaDatos), 'utf8')).ordenes
  const ordenesOct = oct.map((r) => O.aplanarOrden({ plazo_desde: r.numero === '1277' ? '2026-10-22' : null, shopify_preparado: false, listo_origen: null, ...r }))
  const filasOct = E.construirFilasHoja(ordenesOct, cal, '2026-10-31').filas.filter((f) => !f.terminada)
  const refFilas = []
  let pedRef = ''
  for (let r = 4; r <= rh.rowCount; r++) {
    const t = textos(rh, r)
    if (t[0]) pedRef = t[0]
    refFilas.push({ pedido: pedRef, modelo: t[1], medida: t[2], lado: t[3], t: Number(t[8]), f: Number(t[9]), r: Number(t[10]) })
  }
  const clave = (x) => [x.pedido, x.modelo, x.medida, x.lado].join('|')
  const disp = new Map()
  for (const f of filasOct) disp.set(clave(f), [...(disp.get(clave(f)) ?? []), f])
  let coincide = 0
  const difDias = []
  for (const x of refFilas) {
    const m = disp.get(clave(x))?.shift()
    if (!m) continue
    coincide++
    if (m.transcurridos !== x.t || m.faltantes !== x.f || m.retraso !== x.r) difDias.push(`${x.pedido}: ref ${x.t}/${x.f}/${x.r} vs ${m.transcurridos}/${m.faltantes}/${m.retraso}`)
  }
  chequeo('87 de las 89 piezas de la lista del taller se reconstruyen con el mismo pedido, modelo, medida y lado', coincide === 87, String(coincide))
  chequeo('en esas 87, los días hábiles transcurridos, faltantes y de retraso son IDÉNTICOS (1277 contado desde el pago, el 22-10)', difDias.length === 0, difDias.join(' ; '))
} else console.log('\n(sin pruebas/arnes/datos.json: se omite la comparación con octubre)')

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
