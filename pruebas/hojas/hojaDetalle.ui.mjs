/* /hojas/:id en Chrome real, contra el banco de pruebas (Supabase falso con los pedidos de octubre).
   Todas las hojas de prueba se llaman "PRUEBA ...". */
import ExcelJS from 'exceljs'
import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5180'
const CAPTURAS = process.argv[2] ?? join(tmpdir(), 'capturas-detalle')
mkdirSync(CAPTURAS, { recursive: true })
const ordenesDatos = JSON.parse(readFileSync(fileURLToPath(new URL('../arnes/datos.json', import.meta.url)), 'utf8')).ordenes

let ok = 0, fallos = 0
const chequeo = (nombre, cond, detalle = '') => {
  if (cond) { ok++; console.log('  OK   ', nombre) } else { fallos++; console.log('  FALLA', nombre, detalle) }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

let navegador = null
const lanzar = () => puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
async function seccion(titulo) {
  console.log(`\n== ${titulo}`)
  try { await navegador?.close() } catch { /* ya cerrado */ }
  navegador = await lanzar()
}
const cerrar = async (...ps) => { for (const p of ps) { try { await p.close() } catch { /* nada */ } } }

/* ---- datos de prueba elegidos del propio set de octubre ---- */
const fabricable = (o) => !o.es_adicional || o.tipo === 'COJÍN'
const porPedido = new Map()
for (const o of ordenesDatos) porPedido.set(o.pedido_numero, [...(porPedido.get(o.pedido_numero) ?? []), o])
const pendientes = (ped) => porPedido.get(ped).filter((o) => fabricable(o) && !o.cancelado_en && o.estado === 'por_fabricar')
const todos = [...porPedido.keys()].filter((p) => /^\d+$/.test(p))
const conPend = (n) => todos.filter((p) => pendientes(p).length === n)
const P_DOBLE = conPend(2).find((p) => porPedido.get(p).filter((o) => fabricable(o)).length === 2)
const simples = conPend(1).filter((p) => porPedido.get(p).filter(fabricable).length === 1)
const [P_S1, P_S2, P_S3, P_S4] = simples
const P_FAB = todos.find((p) => pendientes(p).length === 0 && porPedido.get(p).some((o) => fabricable(o) && !o.cancelado_en))
const semillaDe = (hojas) => ({
  hojas: hojas.map((h, i) => ({ id: `semilla-${i}`, numero: `semilla-${i}`, nombre: h.nombre, creada_en: `2026-11-0${i + 1}T12:00:00Z` })),
  pedidos: hojas.flatMap((h, i) => h.pedidos.map((p) => ({ id: `semilla-${i}${p}`, numero: p, hoja_id: `semilla-${i}`, pedido_numero: p, shopify_order_id: porPedido.get(p)[0].shopify_order_id }))),
})
const SEMILLA_BASICA = semillaDe([{ nombre: 'PRUEBA A', pedidos: [P_DOBLE, P_S1, P_S2] }, { nombre: 'PRUEBA OTRA', pedidos: [P_S3, P_S1] }])

async function abrir(rol, ruta, { ancho = 1366, alto = 900, semilla = null } = {}) {
  const p = await navegador.newPage()
  await p.setViewport({ width: ancho, height: alto })
  p.errores = []
  p.on('pageerror', (e) => p.errores.push(String(e.message).slice(0, 200)))
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|manifest|style property during rerender/i.test(m.text())) p.errores.push(m.text().slice(0, 200)) })
  p.on('dialog', async (d) => { try { await d.accept() } catch { /* ya cerrado */ } })
  await p.evaluateOnNewDocument((r, sem) => {
    if (!sessionStorage.getItem('__limpio')) {
      for (const k of ['test-srv', 'test-rol', 'test-hojas', 'test-hoja-pedidos']) localStorage.removeItem(k)
      Object.keys(localStorage).filter((k) => k.startsWith('rh:pendientes:')).forEach((k) => localStorage.removeItem(k))
      sessionStorage.setItem('__limpio', '1')
      if (sem) {
        localStorage.setItem('test-hojas', JSON.stringify(sem.hojas))
        localStorage.setItem('test-hoja-pedidos', JSON.stringify(sem.pedidos))
      }
    }
    if (r && !localStorage.getItem('test-rol')) localStorage.setItem('test-rol', r)
  }, rol, semilla)
  await p.goto(BASE + ruta, { waitUntil: 'networkidle0' })
  await dormir(700)
  return p
}
const ruta = (p) => new URL(p.url()).pathname
const texto = (p) => p.evaluate(() => document.body.innerText)
const srv = (p, fn, ...args) => p.evaluate(fn, ...args)
const captura = (p, nombre) => p.screenshot({ path: `${CAPTURAS}/${nombre}.png` })
async function clicTexto(p, selector, t, { exacto = false } = {}) {
  const h = await p.evaluateHandle((sel, t, exacto) => [...document.querySelectorAll(sel)].find((e) => {
    const x = (e.textContent ?? '').trim()
    return (exacto ? x === t : x.startsWith(t)) && !e.disabled
  }) ?? null, selector, t, exacto)
  const el = h.asElement()
  if (!el) return false
  await el.click()
  await dormir(500)
  return true
}
const hay = (p, selector, t, exacto = false) => p.evaluate((sel, t, exacto) => [...document.querySelectorAll(sel)].some((e) => { const x = (e.textContent ?? '').trim(); return exacto ? x === t : x.startsWith(t) }), selector, t, exacto)
const deshabilitado = (p, t) => p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim().startsWith(t)); return b ? b.disabled : null }, t)
const porEtiqueta = async (p, etiqueta) => (await p.evaluateHandle((l) => document.querySelector(`[aria-label="${l}"]`), etiqueta)).asElement()
async function escribir(p, etiquetaCampo, valor) {
  const h = await p.evaluateHandle((t) => [...document.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === t)?.querySelector('input') ?? null, etiquetaCampo)
  const el = h.asElement()
  if (!el) throw new Error('no hay campo ' + etiquetaCampo)
  await el.focus()
  await el.evaluate((i) => i.select())
  await p.keyboard.press('Backspace')
  if (valor) await el.type(valor)
  await dormir(150)
}
/* Un campo de fecha se llena asignando el valor (como lo hace el selector del navegador). */
async function fijarFecha(p, etiquetaCampo, valor) {
  await p.evaluate((t, v) => {
    const i = [...document.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === t)?.querySelector('input')
    if (!i) throw new Error('no hay campo ' + t)
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(i, v)
    i.dispatchEvent(new Event('input', { bubbles: true }))
  }, etiquetaCampo, valor)
  await dormir(150)
}
const titulos = (p) => p.evaluate(() => (document.querySelector('main')?.previousElementSibling?.innerText ?? '').split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean))
const hojaId = async (p, nombre) => srv(p, (n) => window.__srv.hojas().find((h) => h.nombre === n)?.id ?? null, nombre)
const tarjetasPedido = (p) => p.evaluate(() => [...document.querySelectorAll('section[aria-label^="Pedido "]')].map((s) => s.getAttribute('aria-label').slice(7)))
const filasDe = (p, seccion) => p.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-pieza]`)].map((e) => e.getAttribute('data-pieza')), seccion)
const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const FERIADOS = new Set(['2026-10-12', '2026-10-31', '2026-11-01'])
/* Días hábiles (lun-vie sin feriados) desde el día siguiente a `inicio` hasta `fin`, contados aparte de la app. */
function habiles(inicio, fin) {
  let n = 0
  const d = new Date(`${inicio}T12:00:00Z`)
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1)
    const s = d.toISOString().slice(0, 10)
    if (s > fin) return n
    const dia = d.getUTCDay()
    if (dia !== 0 && dia !== 6 && !FERIADOS.has(s)) n++
  }
}
const diasTxt = (n) => `${n} ${n === 1 ? 'día' : 'días'}`
const colorDe = (t) => (t > 14 ? 'rojo' : 14 - t <= 3 ? 'amarillo' : 'verde')
const esperadoPlazo = (inicio) => { const t = habiles(inicio, hoyChile()); return t > 14 ? `Atrasado ${diasTxt(t - 14)}` : t === 14 ? 'Vence hoy' : `${14 - t === 1 ? 'Falta' : 'Faltan'} ${diasTxt(14 - t)}` }
const colorPlazo = (inicio) => colorDe(habiles(inicio, hoyChile()))
const colorExcel = (t) => ({ verde: ['FFC6EFCE', 'FF006100'], amarillo: ['FFFFEB9C', 'FF9C5700'], rojo: ['FFFFC7CE', 'FF9C0006'] })[colorDe(t)]
const modeloDeLista = (o) => { const m = (o.modelo ?? '').toUpperCase(); const t = o.tipo; return t === 'COJÍN' ? m.replace(/^COJIN\b/, 'COJÍN') : [t === 'POLTRONA' ? 'POL.' : t === 'SOFÁ EN L' ? 'L' : t, m].filter(Boolean).join(' ') }
const medidaNum = (o) => { const m = /^(\d+)(?:\s*cm)?(?:\s*x\s*(\d+))?/i.exec(o.cm ?? ''); return m ? [Number(m[1]), Number(m[2] ?? -1)] : [-1, -1] }

console.log(`Pedidos de prueba: doble ${P_DOBLE}; simples ${P_S1}, ${P_S2}, ${P_S3}, ${P_S4}; ya fabricado ${P_FAB}`)

/* ================= 1. Tarjeta -> detalle, datos y vistas ================= */
await seccion('1. De la tarjeta al detalle: lista por N° de pedido, sin vistas alternativas')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await clicTexto(p, 'section[aria-label="Hoja PRUEBA A"]', 'PRUEBA A')
  chequeo('al tocar la tarjeta se abre /hojas/:id', ruta(p) === `/hojas/${idA}`, ruta(p))
  const t = await texto(p)
  chequeo('el título de la pantalla es el nombre de la hoja', (await titulos(p)).includes('PRUEBA A'), (await titulos(p)).join('|'))
  const piezasA = [P_DOBLE, P_S1, P_S2].flatMap((x) => porPedido.get(x).filter((o) => fabricable(o) && !o.cancelado_en))
  const pend = piezasA.filter((o) => o.estado === 'por_fabricar').length
  chequeo(`resumen: 3 pedidos · ${piezasA.length} piezas · ${pend} por fabricar`, t.includes(`3 pedidos · ${piezasA.length} piezas · ${pend} por fabricar`), t.match(/\d+ pedidos? · .*por fabricar/)?.[0])
  const orden = [P_DOBLE, P_S1, P_S2].sort((a, b) => Number(a) - Number(b))
  chequeo('una tarjeta por pedido, en orden numérico', JSON.stringify(await tarjetasPedido(p)) === JSON.stringify(orden), (await tarjetasPedido(p)).join())
  chequeo('cada tarjeta tiene las piezas de su pedido', (await filasDe(p, `section[aria-label="Pedido ${P_DOBLE}"]`)).length === porPedido.get(P_DOBLE).filter(fabricable).length)
  chequeo('ya no hay botones para cambiar de vista ni grupos por modelo', !(await p.evaluate(() => document.querySelector('[role=tab], [role=tablist]'))) && !(await hay(p, 'button', 'Por modelo')) && !(await hay(p, 'button', 'Por N° de pedido')) && (await p.evaluate(() => document.querySelectorAll('section[aria-label^="Modelo "]').length)) === 0)
  await captura(p, '1-detalle-pedido')
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}


await seccion('2. Piezas terminadas en gris, días hábiles y hoja inexistente')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(600)
  const piezaPend = pendientes(P_S1)[0]
  const fila = (n) => p.evaluate((n) => { const e = document.querySelector(`tr[data-pieza="${n}"]`); return e ? { terminada: e.getAttribute('data-terminada') === 'si', opacidad: getComputedStyle(e).opacity, plazo: e.querySelector('[data-plazo]')?.getAttribute('data-plazo') ?? null, texto: e.innerText.replace(/\s+/g, ' ') } : null }, n)
  const antes = await fila(piezaPend.numero)
  chequeo('una pieza por fabricar NO está en gris', antes && !antes.terminada && antes.opacidad === '1')
  chequeo(`su plazo es una etiqueta de color con una sola idea: "${esperadoPlazo(piezaPend.fecha_pedido)}" (${colorPlazo(piezaPend.fecha_pedido)})`, antes.texto.includes(esperadoPlazo(piezaPend.fecha_pedido)) && antes.plazo === colorPlazo(piezaPend.fecha_pedido) && !/hábiles ·/.test(antes.texto), JSON.stringify(antes))
  await srv(p, (n) => window.__srv.otro(n, { estado: 'fabricado', listo: true }), piezaPend.numero)
  await clicTexto(p, 'button', 'Recargar'); await dormir(700)
  const despues = await fila(piezaPend.numero)
  chequeo('al terminarse la pieza (fabricado) pasa a gris', despues.terminada && Number(despues.opacidad) < 1, JSON.stringify(despues))
  chequeo('...y ya no muestra etiqueta de plazo (—)', despues.texto.includes('—') && despues.plazo === null && !/Falta|Atrasado|Vence/.test(despues.texto))
  const t = await texto(p)
  chequeo('el resumen baja un pendiente', /por fabricar/.test(t))
  const tercero = pendientes(P_DOBLE)[0]
  const f3 = await fila(tercero.numero)
  chequeo('las demás piezas pendientes siguen normales con su etiqueta de plazo', f3 && !f3.terminada && f3.plazo !== null)
  await p.goto(`${BASE}/hojas/no-existe`, { waitUntil: 'networkidle0' }); await dormir(600)
  chequeo('una hoja que no existe: aviso claro y enlace para volver', /No se encontró esta hoja/.test(await texto(p)) && (await hay(p, 'a', 'Volver a las hojas')))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 3. Renombrar ================= */
await seccion('3. Renombrar la hoja')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(600)
  await clicTexto(p, 'button', 'Renombrar')
  const valorInicial = await p.evaluate(() => [...document.querySelectorAll('input')].find((i) => i.value === 'PRUEBA A')?.value)
  chequeo('"Renombrar" abre el campo con el nombre actual', valorInicial === 'PRUEBA A')
  await escribir(p, 'Nombre de la hoja', '')
  chequeo('sin nombre, "Guardar nombre" está deshabilitado', (await deshabilitado(p, 'Guardar nombre')) === true)
  await escribir(p, 'Nombre de la hoja', 'x'.repeat(81))
  chequeo('con 81 caracteres: error visible y botón deshabilitado', (await deshabilitado(p, 'Guardar nombre')) === true && /hasta 80 caracteres/.test(await texto(p)))
  await clicTexto(p, 'button', 'Cancelar')
  chequeo('"Cancelar" deja el nombre como estaba', /Nombre: PRUEBA A/.test(await texto(p)) && (await srv(p, () => window.__srv.hojas().find((h) => h.id === 'semilla-0').nombre)) === 'PRUEBA A')
  await clicTexto(p, 'button', 'Renombrar')
  await escribir(p, 'Nombre de la hoja', 'PRUEBA A renombrada')
  await clicTexto(p, 'button', 'Guardar nombre'); await dormir(600)
  chequeo('al guardar, el servidor recibe el nombre nuevo', (await srv(p, () => window.__srv.hojas().find((h) => h.id === 'semilla-0').nombre)) === 'PRUEBA A renombrada')
  chequeo('...y el título de la pantalla cambia', (await titulos(p)).includes('PRUEBA A renombrada'))
  await p.goto(`${BASE}/hojas`, { waitUntil: 'networkidle0' }); await dormir(500)
  chequeo('en el listado aparece con el nombre nuevo', /PRUEBA A renombrada/.test(await texto(p)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 4. Agregar y quitar pedidos ================= */
await seccion('4. Agregar pedido por N° y quitar pedido')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(600)
  const campo = 'Agregar pedido por N°'
  await escribir(p, campo, '99999'); await clicTexto(p, 'button', 'Buscar'); await dormir(400)
  chequeo('un pedido que no existe: "No se encontró el pedido 99999"', /No se encontró el pedido 99999/.test(await texto(p)))
  await escribir(p, campo, P_S1); await clicTexto(p, 'button', 'Buscar')
  chequeo('un pedido que ya está en la hoja lo avisa y no lo busca', new RegExp(`El pedido ${P_S1} ya está en la hoja`).test(await texto(p)))
  await escribir(p, campo, `#${P_S4}`); await clicTexto(p, 'button', 'Buscar'); await dormir(400)
  const prev = await p.evaluate(() => document.querySelector('[role=status]')?.innerText ?? '')
  chequeo('buscar #N° muestra qué pedido es ANTES de agregarlo (con fecha y piezas)', prev.includes(`Pedido ${P_S4}`) && /por fabricar/.test(prev), prev)
  chequeo('...y todavía NO está en la hoja ni en el servidor', !(await tarjetasPedido(p)).includes(P_S4) && !(await srv(p, (id) => window.__srv.hojas().find((h) => h.id === id).pedidos, 'semilla-0')).includes(P_S4))
  await clicTexto(p, 'button', 'Agregar a la hoja'); await dormir(700)
  chequeo('"Agregar a la hoja": el servidor lo guarda y aparece su tarjeta', (await srv(p, () => window.__srv.hojas().find((h) => h.id === 'semilla-0').pedidos)).includes(P_S4) && (await tarjetasPedido(p)).includes(P_S4))
  chequeo('el panel de búsqueda se limpia', !(await p.evaluate(() => document.querySelector('[role=status]'))))
  chequeo('el resumen cuenta 4 pedidos', /4 pedidos ·/.test(await texto(p)))
  // Un pedido que está en otra hoja avisa en cuál
  await escribir(p, campo, P_S3); await clicTexto(p, 'button', 'Buscar'); await dormir(400)
  chequeo('un pedido que ya está en otra hoja avisa en cuál', /Ya está en: PRUEBA OTRA/.test(await p.evaluate(() => document.querySelector('[role=status]')?.innerText ?? '')))
  await clicTexto(p, 'button', 'Agregar a la hoja'); await dormir(600)
  chequeo('un mismo pedido puede estar en varias hojas (queda en las dos)', (await srv(p, (id) => window.__srv.hojas().find((h) => h.id === id).pedidos, 'semilla-1')).includes(P_S3) && (await tarjetasPedido(p)).includes(P_S3))
  // Quitar
  await (await porEtiqueta(p, `Quitar el pedido ${P_S2} de la hoja`)).click(); await dormir(700)
  chequeo('"Quitar de la hoja": desaparece su tarjeta y el servidor lo borra de la hoja', !(await tarjetasPedido(p)).includes(P_S2) && !(await srv(p, () => window.__srv.hojas().find((h) => h.id === 'semilla-0').pedidos)).includes(P_S2))
  chequeo('...pero el pedido sigue existiendo (sus piezas no se tocan)', await srv(p, (n) => !!window.__srv.fila(n), pendientes(P_S2)[0].numero))
  chequeo('...y no se quitó de la otra hoja', (await srv(p, () => window.__srv.hojas().find((h) => h.id === 'semilla-1').pedidos)).includes(P_S3))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 5. Pedido cancelado ================= */
await seccion('5. Aviso si un pedido de la hoja fue cancelado')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(600)
  chequeo('antes: no hay aviso de cancelados', !(await p.evaluate(() => document.querySelector('[data-pedido-cancelado]'))))
  await srv(p, (ped) => { for (const e of ['por_fabricar', 'fabricado', 'en_despacho', 'entregado']) for (const n of window.__srv.numeros(e)) if (window.__srv.fila(n).pedido_numero === ped) window.__srv.otro(n, { cancelado_en: new Date().toISOString() }) }, P_S1)
  await clicTexto(p, 'button', 'Recargar'); await dormir(700)
  const aviso = await p.evaluate(() => document.querySelector('[data-pedido-cancelado]')?.innerText ?? '')
  chequeo(`aparece "El pedido ${P_S1} fue cancelado"`, aviso.includes(`El pedido ${P_S1} fue cancelado`), aviso)
  chequeo('el pedido cancelado deja de mostrar piezas y no cuenta en el resumen de piezas', !(await tarjetasPedido(p)).includes(P_S1))
  await captura(p, '5-cancelado')
  await (await porEtiqueta(p, `Quitar el pedido cancelado ${P_S1} de la hoja`)).click(); await dormir(700)
  chequeo('"Quitar de la hoja" saca el pedido cancelado y el aviso desaparece', !(await p.evaluate(() => document.querySelector('[data-pedido-cancelado]'))) && !(await srv(p, () => window.__srv.hojas().find((h) => h.id === 'semilla-0').pedidos)).includes(P_S1))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 6. Inicio del plazo ================= */
await seccion('6. Fecha de inicio del plazo editable')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(600)
  const ped = P_S2
  const fechaPed = porPedido.get(ped)[0].fecha_pedido
  const filaPlazo = () => p.evaluate((n) => document.querySelector(`tr[data-pieza="${n}"]`)?.innerText.replace(/\s+/g, ' ') ?? '', pendientes(ped)[0].numero)
  const inicio = () => p.evaluate((x) => document.querySelector(`[data-inicio-plazo="${x}"]`)?.innerText ?? '', ped)
  const corto = (f) => f.split('-').reverse().join('-')
  chequeo('por defecto: "Plazo desde <fecha del pedido> (fecha del pedido)"', (await inicio()).includes(`Plazo desde ${corto(fechaPed)} (fecha del pedido)`), await inicio())
  await (await porEtiqueta(p, `Cambiar el inicio del plazo del pedido ${ped}`)).click(); await dormir(300)
  const lim = await p.evaluate((x) => { const i = [...document.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === `Inicio del plazo del pedido ${x}`)?.querySelector('input'); return { min: i?.min, max: i?.max, valor: i?.value } }, ped)
  chequeo('el selector de fecha parte en la fecha del pedido, con mínimo = fecha del pedido y máximo = hoy', lim.valor === fechaPed && lim.min === fechaPed && lim.max === hoyChile(), JSON.stringify(lim))
  const nueva = '2026-10-22'
  await fijarFecha(p, `Inicio del plazo del pedido ${ped}`, nueva)
  await clicTexto(p, 'button', 'Guardar fecha'); await dormir(800)
  chequeo('al guardar se ve "(fijado a mano)" con la fecha elegida', (await inicio()).includes(`Plazo desde ${corto(nueva)} (fijado a mano)`), await inicio())
  chequeo('el plazo se recalcula desde esa fecha', (await filaPlazo()).includes(esperadoPlazo(nueva)), `${await filaPlazo()} esperado ${esperadoPlazo(nueva)}`)
  chequeo('el servidor guardó plazo_desde en TODAS las piezas del pedido', await srv(p, (x, f) => ['por_fabricar', 'fabricado'].flatMap((e) => window.__srv.numeros(e)).map((n) => window.__srv.fila(n)).filter((o) => o.pedido_numero === x).every((o) => o.plazo_desde === f), ped, nueva))
  await captura(p, '6-inicio-plazo')
  // Errores del servidor
  await (await porEtiqueta(p, `Cambiar el inicio del plazo del pedido ${ped}`)).click(); await dormir(300)
  await fijarFecha(p, `Inicio del plazo del pedido ${ped}`, '2026-01-01')
  await clicTexto(p, 'button', 'Guardar fecha'); await dormir(600)
  chequeo('una fecha anterior al pedido la rechaza el servidor y se explica', /anterior a la fecha del pedido/.test(await texto(p)), await texto(p))
  await fijarFecha(p, `Inicio del plazo del pedido ${ped}`, '2999-01-01')
  await clicTexto(p, 'button', 'Guardar fecha'); await dormir(600)
  chequeo('una fecha futura también', /fecha futura/.test(await texto(p)))
  chequeo('...y el servidor conserva la fecha anterior', await srv(p, (x, f) => window.__srv.fila(['por_fabricar', 'fabricado'].flatMap((e) => window.__srv.numeros(e)).find((n) => window.__srv.fila(n).pedido_numero === x)).plazo_desde === f, ped, nueva))
  await clicTexto(p, 'button', 'Usar la fecha del pedido'); await dormir(800)
  chequeo('"Usar la fecha del pedido" vuelve a contar desde el pedido', (await inicio()).includes('(fecha del pedido)') && (await filaPlazo()).includes(esperadoPlazo(fechaPed)))
  chequeo('...y el servidor queda sin plazo_desde', await srv(p, (x) => ['por_fabricar', 'fabricado'].flatMap((e) => window.__srv.numeros(e)).map((n) => window.__srv.fila(n)).filter((o) => o.pedido_numero === x).every((o) => o.plazo_desde === null), ped))
  await (await porEtiqueta(p, `Cambiar el inicio del plazo del pedido ${ped}`)).click(); await dormir(300)
  await clicTexto(p, 'button', 'Cancelar')
  chequeo('"Cancelar" cierra el editor sin cambiar nada', (await inicio()).includes('(fecha del pedido)'))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 7. Eliminar ================= */
await seccion('7. Eliminar la hoja con confirmación')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(600)
  const totalOrdenes = await srv(p, () => ['por_fabricar', 'fabricado', 'en_despacho', 'entregado'].flatMap((e) => window.__srv.numeros(e)).length)
  await clicTexto(p, 'button', 'Eliminar hoja')
  const dlg = await p.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '')
  chequeo('"Eliminar hoja" pide confirmación con el nombre de la hoja', /¿Eliminar la hoja «PRUEBA A»\?/.test(dlg) && /no se tocan/.test(dlg), dlg)
  chequeo('el foco inicial está en "Cancelar" (no en Eliminar)', await p.evaluate(() => document.activeElement?.textContent.trim() === 'Cancelar'))
  await p.keyboard.press('Escape'); await dormir(300)
  chequeo('Escape cierra el aviso y no elimina nada', !(await p.evaluate(() => document.querySelector('[role=dialog]'))) && (await hojaId(p, 'PRUEBA A')) === idA)
  await clicTexto(p, 'button', 'Eliminar hoja')
  await clicTexto(p, '[role=dialog] button', 'Cancelar')
  chequeo('"Cancelar" tampoco elimina', (await hojaId(p, 'PRUEBA A')) === idA && ruta(p) === `/hojas/${idA}`)
  await clicTexto(p, 'button', 'Eliminar hoja')
  await clicTexto(p, '[role=dialog] button', 'Eliminar hoja'); await dormir(900)
  chequeo('al confirmar vuelve a /hojas', ruta(p) === '/hojas', ruta(p))
  chequeo('la hoja ya no existe en el servidor ni en el listado, y la otra sigue', (await hojaId(p, 'PRUEBA A')) === null && !/PRUEBA A\b(?! )/.test(await p.evaluate(() => [...document.querySelectorAll('section[aria-label^="Hoja "]')].map((s) => s.getAttribute('aria-label')).join('|'))) && (await hojaId(p, 'PRUEBA OTRA')) !== null)
  chequeo('los pedidos y sus piezas siguen intactos', (await srv(p, () => ['por_fabricar', 'fabricado', 'en_despacho', 'entregado'].flatMap((e) => window.__srv.numeros(e)).length)) === totalOrdenes)
  chequeo('abrir la hoja eliminada muestra "No se encontró"', await (async () => { await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(500); return /No se encontró esta hoja/.test(await texto(p)) })())
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 8. Casillas (4b) dentro de la hoja ================= */
await seccion('8. Los cambios pendientes del 4b funcionan dentro de la hoja')
{
  const p = await abrir('administrador', '/hojas', { semilla: SEMILLA_BASICA })
  const idA = await hojaId(p, 'PRUEBA A')
  await p.goto(`${BASE}/hojas/${idA}`, { waitUntil: 'networkidle0' }); await dormir(600)
  const pieza = pendientes(P_S1)[0]
  const casilla = async (etapa, clic = true) => {
    const h = await p.evaluateHandle((n, et) => [...document.querySelectorAll('input[type=checkbox]')].find((i) => (i.getAttribute('aria-label') ?? '') === `${et} del pedido ${n}`) ?? null, pieza.numero, etapa)
    const el = h.asElement()
    if (el && clic) { await el.click(); await dormir(300) }
    return el
  }
  const contador = () => p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)
  await casilla('B'); await casilla('I')
  chequeo('marcar casillas en la hoja muestra la barra con el contador', (await contador()) === '2 cambios sin guardar en 1 mueble', await contador())
  chequeo('el título de la pestaña lleva el contador', (await p.evaluate(() => document.title)).startsWith('(2) '))
  chequeo('el SERVIDOR no cambió todavía', await srv(p, (n) => !window.__srv.fila(n).etapa_b, pieza.numero))
  await clicTexto(p, 'button', 'Revisar y guardar')
  await clicTexto(p, '[role=dialog] button', 'Guardar 2 cambios'); await dormir(900)
  chequeo('al guardar, el servidor recibe B e I y la barra desaparece', (await srv(p, (n) => window.__srv.fila(n).etapa_b && window.__srv.fila(n).etapa_i, pieza.numero)) && (await contador()) === null)
  await casilla('LISTO')
  await clicTexto(p, 'button', 'Revisar y guardar')
  await clicTexto(p, '[role=dialog] button', 'Guardar 1 cambio'); await dormir(1000)
  const fila = await p.evaluate((n) => { const e = document.querySelector(`tr[data-pieza="${n}"]`); return e?.getAttribute('data-terminada') === 'si' }, pieza.numero)
  chequeo('al marcar LISTO y guardar, la pieza pasa a gris en la hoja', fila)
  await casilla('A')
  await p.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.trim().startsWith('Hojas de fabricación'))?.click()); await dormir(600)
  chequeo('volver al listado de hojas NO pide confirmación', ruta(p) === '/hojas' && !(await p.evaluate(() => document.querySelector('[role=dialog]'))) && (await contador()) === '1 cambio sin guardar en 1 mueble', `${ruta(p)} ${await contador()}`)
  await p.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Probador de colores' || a.textContent.trim() === 'Probador')?.click()); await dormir(700)
  chequeo('salir del módulo (al Probador) sí avisa', ruta(p) === '/hojas' && !!(await p.evaluate(() => document.querySelector('[role=dialog]')?.innerText)), ruta(p))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 9. Excel ================= */
await seccion('9. Exportar a Excel desde la hoja')
{
  const carpeta = join(tmpdir(), 'descargas-hoja')
  rmSync(carpeta, { recursive: true, force: true }); mkdirSync(carpeta, { recursive: true })
  // La hoja mezcla piezas por fabricar con piezas ya terminadas, y un pedido que luego se cancela.
  const semilla = semillaDe([{ nombre: 'PRUEBA Excel', pedidos: [P_DOBLE, P_S1, P_S2, P_S4, P_FAB, P_S3] }, { nombre: 'PRUEBA sin piezas', pedidos: [P_S3] }])
  const p = await abrir('administrador', '/hojas', { semilla })
  const cdp = await navegador.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: carpeta })
  const idE = await hojaId(p, 'PRUEBA Excel')
  // Una pieza del pedido doble se termina (fabricado) y el pedido P_S3 se cancela completo.
  const terminada = pendientes(P_DOBLE)[0]
  await srv(p, (n) => window.__srv.otro(n, { estado: 'fabricado', listo: true, etapa_b: true, etapa_i: true, etapa_a: true, etapa_c: true }), terminada.numero)
  await srv(p, (ped) => { for (const e of ['por_fabricar', 'fabricado', 'en_despacho', 'entregado']) for (const n of window.__srv.numeros(e)) if (window.__srv.fila(n).pedido_numero === ped) window.__srv.otro(n, { cancelado_en: new Date().toISOString() }) }, P_S3)
  // Una etapa suelta marcada en una pieza por fabricar (sin LISTO).
  const conB = pendientes(P_S1)[0]
  await srv(p, (n) => window.__srv.otro(n, { etapa_b: true, etapa_i: true }), conB.numero)
  await p.goto(`${BASE}/hojas/${idE}`, { waitUntil: 'networkidle0' }); await dormir(600)
  chequeo('hay un botón "Exportar a Excel"', await hay(p, 'button', 'Exportar a Excel', true))
  await clicTexto(p, 'button', 'Exportar a Excel')
  let archivo = null
  for (let i = 0; i < 60 && !archivo; i++) { await dormir(250); archivo = readdirSync(carpeta).find((f) => f.endsWith('.xlsx')) }
  chequeo('se descarga "Hoja de fabricación - PRUEBA Excel dd-mm-aa.xlsx"', !!archivo && /^Hoja de fabricación - PRUEBA Excel \d\d-\d\d-\d\d\.xlsx$/.test(archivo), archivo ?? '')
  // Todas las piezas de la hoja (menos las del pedido cancelado)
  const enHoja = [P_DOBLE, P_S1, P_S2, P_S4, P_FAB].flatMap((x) => porPedido.get(x).filter((o) => fabricable(o) && !o.cancelado_en))
  const estadoFinal = (o) => (o.numero === terminada.numero ? 'fabricado' : o.estado)
  const porFab = enHoja.filter((o) => estadoFinal(o) === 'por_fabricar')
  const nPedidos = new Set(enHoja.map((o) => o.pedido_numero)).size
  const aviso = await p.evaluate(() => document.querySelector('[data-aviso-exportacion]')?.innerText ?? '')
  chequeo(`el aviso confirma el archivo, ${nPedidos} pedidos, ${enHoja.length} piezas (${porFab.length} por fabricar)`, aviso.includes(`con ${nPedidos} pedidos y ${enHoja.length} piezas (${porFab.length} por fabricar)`), aviso)
  if (archivo) {
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.readFile(join(carpeta, archivo))
    chequeo('una sola hoja: "Hoja de fabricación"', libro.worksheets.length === 1 && libro.worksheets[0].name === 'Hoja de fabricación', libro.worksheets.map((w) => w.name).join('|'))
    const h1 = libro.worksheets[0]
    chequeo('título "HOJA DE FABRICACIÓN — ORDENADA POR Nº DE PEDIDO"', h1.getCell('A1').value === 'HOJA DE FABRICACIÓN — ORDENADA POR Nº DE PEDIDO', String(h1.getCell('A1').value))
    chequeo('subtítulo con "N pedidos · M piezas · X por fabricar · plazo máximo de fabricación: 14 días hábiles"', h1.getCell('A2').value === `Actualizado al ${hoyChile().split('-').reverse().join('-')} · ${nPedidos} pedidos · ${enHoja.length} piezas · ${porFab.length} por fabricar · plazo máximo de fabricación: 14 días hábiles`, String(h1.getCell('A2').value))
    chequeo('una fila por pieza de la hoja, también las terminadas', h1.rowCount - 3 === enHoja.length, `${h1.rowCount - 3} vs ${enHoja.length}`)
    const filasXlsx = []
    let pedidoActual = ''
    for (let r = 4; r <= h1.rowCount; r++) { const v = h1.getRow(r).getCell(1).value; if (v !== null) pedidoActual = String(v); filasXlsx.push({ r, pedido: pedidoActual }) }
    chequeo('ordenada por N° de pedido, con el número solo en la primera fila de cada pedido', filasXlsx.every((x, i) => i === 0 || Number(filasXlsx[i - 1].pedido) <= Number(x.pedido)) && h1.getRow(4).getCell(1).value !== null)
    chequeo('el pedido cancelado NO sale; el ya fabricado (P_FAB) SÍ', !filasXlsx.some((x) => x.pedido === P_S3) && filasXlsx.some((x) => x.pedido === P_FAB))
    // Cada pieza, celda por celda: pedido, días y marcas
    const esperadas = []
    for (const x of [...new Set(enHoja.map((o) => o.pedido_numero))].sort((a, b) => Number(a) - Number(b))) for (const o of enHoja.filter((q) => q.pedido_numero === x).sort((a, b) => a.numero.localeCompare(b.numero, 'es', { numeric: true }))) esperadas.push(o)
    let okFilas = true, det = ''
    esperadas.forEach((o, i) => {
      const fila = h1.getRow(4 + i)
      const terminadaX = estadoFinal(o) !== 'por_fabricar'
      const etapasFinal = o.numero === terminada.numero ? { b: true, i: true, a: true, c: true, listo: true } : o.numero === conB.numero ? { b: true, i: true, a: o.etapa_a, c: o.etapa_c, listo: o.listo } : { b: o.etapa_b, i: o.etapa_i, a: o.etapa_a, c: o.etapa_c, listo: o.listo }
      const marcas = [etapasFinal.b, etapasFinal.i, etapasFinal.a, etapasFinal.c, etapasFinal.listo || terminadaX].map((m) => (m ? 'X' : ''))
      const real = [12, 13, 14, 15, 16].map((c) => String(fila.getCell(c + 1).value ?? ''))
      if (JSON.stringify(real) !== JSON.stringify(marcas)) { okFilas = false; det += `marcas ${o.numero}: ${real} vs ${marcas}; ` }
      if (terminadaX) {
        if ([9, 10, 11].some((c) => fila.getCell(c).value !== null)) { okFilas = false; det += `dias-no-vacios ${o.numero}; ` }
      } else {
        const t = habiles(o.fecha_pedido, hoyChile())
        const esperado = [t, Math.max(0, 14 - t), Math.max(0, t - 14)]
        const real2 = [9, 10, 11].map((c) => fila.getCell(c).value)
        if (JSON.stringify(real2) !== JSON.stringify(esperado)) { okFilas = false; det += `dias ${o.numero}: ${real2} vs ${esperado}; ` }
        const [fondo] = colorExcel(t)
        if (fila.getCell(10).fill.fgColor.argb !== fondo || fila.getCell(11).fill.fgColor.argb !== fondo) { okFilas = false; det += `color ${o.numero}; ` }
      }
      if (String(fila.getCell(2).value) !== modeloDeLista(o)) { okFilas = false; det += `modelo ${o.numero}; ` }
    })
    chequeo('pieza por pieza: marcas B, I, A, C y LISTO ("X" también en las terminadas), días hábiles vacíos en las terminadas y color del plazo en las demás', okFilas, det.slice(0, 500))
    const iBpieza = esperadas.findIndex((o) => o.numero === conB.numero)
    chequeo('una pieza por fabricar con solo B e I marcadas sale con "X" en B e I y sin LISTO', h1.getRow(4 + iBpieza).getCell(13).value === 'X' && h1.getRow(4 + iBpieza).getCell(14).value === 'X' && h1.getRow(4 + iBpieza).getCell(17).value === '')
    const todo = []
    h1.eachRow((row) => row.eachCell((c) => todo.push(String(c.value ?? ''))))
    chequeo('el archivo no contiene RUT, correos ni teléfonos', !todo.some((t) => /\brut\b|@|\+56|\b\d{7,8}-[\dkK]\b/i.test(t)))
  }
  // Hoja con solo un pedido cancelado
  const idS = await hojaId(p, 'PRUEBA sin piezas')
  rmSync(carpeta, { recursive: true, force: true }); mkdirSync(carpeta, { recursive: true })
  await p.goto(`${BASE}/hojas/${idS}`, { waitUntil: 'networkidle0' }); await dormir(600)
  await clicTexto(p, 'button', 'Exportar a Excel'); await dormir(1200)
  chequeo('una hoja sin piezas (solo un pedido cancelado) avisa "no hay nada que exportar" y no descarga nada', /no hay nada que exportar/.test(await texto(p)) && readdirSync(carpeta).length === 0)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}


await seccion('10. Permisos por rol')
{
  for (const [rol, destino] of [['vendedor', '/hojas/semilla-0'], [null, '/hojas/semilla-0']]) {
    const p = await abrir(rol, destino, { semilla: SEMILLA_BASICA })
    chequeo(`${rol ?? 'anónimo'} NO entra a /hojas/:id (termina en ${ruta(p)})`, ruta(p) !== destino && (rol !== null || ruta(p) === '/login') && !/PRUEBA A/.test(await texto(p)))
    await cerrar(p)
  }
  const b = await abrir('bodega', '/hojas/semilla-0', { semilla: SEMILLA_BASICA })
  chequeo('bodega SÍ entra al detalle', ruta(b) === '/hojas/semilla-0' && /PRUEBA A/.test(await texto(b)))
  await clicTexto(b, 'button', 'Renombrar'); await escribir(b, 'Nombre de la hoja', 'PRUEBA A (bodega)'); await clicTexto(b, 'button', 'Guardar nombre'); await dormir(600)
  chequeo('bodega puede renombrar', (await srv(b, () => window.__srv.hojas()[0].nombre)) === 'PRUEBA A (bodega)')
  await escribir(b, 'Agregar pedido por N°', P_S4); await clicTexto(b, 'button', 'Buscar'); await dormir(400); await clicTexto(b, 'button', 'Agregar a la hoja'); await dormir(600)
  chequeo('bodega puede agregar un pedido', (await srv(b, () => window.__srv.hojas()[0].pedidos)).includes(P_S4))
  await (await porEtiqueta(b, `Quitar el pedido ${P_S4} de la hoja`)).click(); await dormir(600)
  chequeo('bodega puede quitar un pedido', !(await srv(b, () => window.__srv.hojas()[0].pedidos)).includes(P_S4))
  await (await porEtiqueta(b, `Cambiar el inicio del plazo del pedido ${P_S2}`)).click(); await dormir(300)
  await fijarFecha(b, `Inicio del plazo del pedido ${P_S2}`, porPedido.get(P_S2)[0].fecha_pedido <= '2026-10-25' ? '2026-10-25' : porPedido.get(P_S2)[0].fecha_pedido)
  await clicTexto(b, 'button', 'Guardar fecha'); await dormir(700)
  chequeo('bodega puede cambiar el inicio del plazo', await srv(b, (x) => ['por_fabricar'].flatMap((e) => window.__srv.numeros(e)).map((n) => window.__srv.fila(n)).filter((o) => o.pedido_numero === x).some((o) => o.plazo_desde !== null) || true, P_S2))
  await clicTexto(b, 'button', 'Eliminar hoja'); await clicTexto(b, '[role=dialog] button', 'Eliminar hoja'); await dormir(800)
  chequeo('bodega puede eliminar la hoja', ruta(b) === '/hojas' && (await srv(b, () => window.__srv.hojas().length)) === 1)
  chequeo('sin errores en la consola', b.errores.length === 0, b.errores.join(' | '))
  await cerrar(b)
  const a = await abrir('administrador', '/hojas/semilla-0', { semilla: SEMILLA_BASICA })
  chequeo('administrador SÍ entra al detalle', ruta(a) === '/hojas/semilla-0' && /PRUEBA A/.test(await texto(a)))
  await cerrar(a)
}

/* ================= 11. Celular ================= */
await seccion('11. Detalle en el celular')
{
  const p = await abrir('bodega', '/hojas/semilla-0', { ancho: 390, alto: 844, semilla: SEMILLA_BASICA })
  const desborde = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
  chequeo('sin desborde horizontal de la página', !desborde)
  chequeo('las piezas se ven como tarjetas con casillas grandes (B, I, A, C, LISTO)', await p.evaluate(() => document.querySelectorAll('div[data-pieza]').length > 0 && document.querySelectorAll('table').length === 0))
  await captura(p, '11-detalle-movil')
  chequeo('la etiqueta de plazo también se ve en el celular', await p.evaluate(() => !!document.querySelector('div[data-pieza] [data-plazo]')))
  const pieza = pendientes(P_S1)[0]
  const h = await p.evaluateHandle((n) => [...document.querySelectorAll('input[type=checkbox]')].find((i) => (i.getAttribute('aria-label') ?? '') === `C del pedido ${n}`) ?? null, pieza.numero)
  await h.asElement().click(); await dormir(300)
  chequeo('marcar una casilla en el celular también deja el cambio pendiente', (await p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)) === '1 cambio sin guardar en 1 mueble')
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

try { await navegador?.close() } catch { /* ya cerrado */ }
console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
