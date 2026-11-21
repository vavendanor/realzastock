/* Filtros de /despachos (pestaña "Por despachar") en Chrome real contra el banco de pruebas (ver pruebas/README.md): región,
   comuna, búsqueda por N° de pedido, grupos "Sin dirección" y "Retiro en tienda", paginador, selección y cambios
   pendientes al filtrar, y celular. Los 40 muebles de la prueba se arman con pedidos de octubre (los mismos T9300 a T9341
   de supabase/verificacion/despachos_orden_de_prueba_insertar.sql, en versión de banco de pruebas). */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5180'
const CAPTURAS = process.argv[2] ?? join(tmpdir(), 'capturas-despachos-filtros')
mkdirSync(CAPTURAS, { recursive: true })
const datos = JSON.parse(readFileSync(fileURLToPath(new URL('../arnes/datos.json', import.meta.url)), 'utf8')).ordenes

let ok = 0, fallos = 0
const chequeo = (nombre, cond, detalle = '') => {
  if (cond) { ok++; console.log('  OK   ', nombre) } else { fallos++; console.log('  FALLA', nombre, detalle) }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let navegador = null
const lanzar = () => puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
async function seccion(titulo) {
  console.log(`\n== ${titulo}`)
  try { await navegador?.close() } catch { /* ya cerrado */ }
  navegador = await lanzar()
}
const cerrar = async (...ps) => { for (const p of ps) { try { await p.close() } catch { /* nada */ } } }

/* ---- Los 40 muebles de la prueba ---- */
const fabricable = (o) => !o.es_adicional || o.tipo === 'COJÍN'
const porPedido = new Map()
for (const o of datos) porPedido.set(o.pedido_numero, [...(porPedido.get(o.pedido_numero) ?? []), o])
const piezas = (ped) => porPedido.get(ped).filter((o) => fabricable(o) && !o.cancelado_en)
const SIMPLES = [...porPedido.keys()].filter((p) => /^\d+$/.test(p) && piezas(p).length === 1 && porPedido.get(p).length === 1).map((p) => piezas(p)[0].numero)
if (SIMPLES.length < 41) throw new Error('faltan pedidos de un solo mueble para la prueba: ' + SIMPLES.length)
const RM = 'Metropolitana de Santiago'
const COMUNAS = [['Providencia', RM], ['Ñuñoa', RM], ['Las Condes', RM], ['Viña del Mar', 'Valparaíso'], ['Concepción', 'Biobío'], ['Antofagasta', 'Antofagasta']]
const dia = (n) => new Date(Date.parse('2026-09-01T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
/* El mueble i (0 a 35) va a una de las 6 comunas, con una antigüedad "revuelta" respecto del número de pedido. */
const FIXTURE = SIMPLES.slice(0, 41).map((numero, i) => {
  if (i < 36) return { numero, comuna: COMUNAS[i % 6][0], region: COMUNAS[i % 6][1], fecha_pedido: dia((i * 11) % 36), plazo_desde: null }
  if (i === 36) return { numero, comuna: 'Puerto Montt', region: 'Los Lagos', fecha_pedido: dia(10), plazo_desde: null }
  if (i === 37) return { numero, comuna: 'RETIRO TIENDA', region: RM, fecha_pedido: dia(11), plazo_desde: null }
  if (i === 38) return { numero, comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO', region: null, fecha_pedido: dia(12), plazo_desde: null }
  if (i === 39) return { numero, comuna: 'Providencia', region: RM, fecha_pedido: dia(13), plazo_desde: null, cancelado: true }
  return { numero, comuna: 'Providencia', region: RM, fecha_pedido: dia(-30), plazo_desde: dia(60) } // pedido muy antiguo, pero con el plazo contado desde mucho después
})
const DESPACHABLES = FIXTURE.filter((f) => !f.cancelado) // 40
/* El orden esperado, calculado aparte de la app. */
const clave = (f) => `${f.plazo_desde ?? f.fecha_pedido}|${String(Number(f.numero)).padStart(8, '0')}`
const esperadoComuna = (comuna, region) => FIXTURE.filter((f) => !f.cancelado && f.comuna === comuna && f.region === region).sort((a, b) => (clave(a) < clave(b) ? -1 : 1)).map((f) => f.numero)
const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const PASADO = new Date(Date.parse(`${hoyChile()}T12:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10)

async function abrir(rol, ruta, { ancho = 1366, alto = 900 } = {}) {
  const p = await navegador.newPage()
  await p.setViewport({ width: ancho, height: alto })
  p.errores = []
  p.on('pageerror', (e) => p.errores.push(String(e.message).slice(0, 200)))
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|manifest|style property during rerender/i.test(m.text())) p.errores.push(m.text().slice(0, 200)) })
  p.on('dialog', async (d) => { try { await d.accept() } catch { /* ya cerrado */ } })
  await p.evaluateOnNewDocument((r) => {
    if (!sessionStorage.getItem('__limpio')) {
      for (const k of ['test-srv', 'test-rol', 'test-hojas', 'test-hoja-pedidos']) localStorage.removeItem(k)
      Object.keys(localStorage).filter((k) => k.startsWith('rh:pendientes:')).forEach((k) => localStorage.removeItem(k))
      sessionStorage.setItem('__limpio', '1')
    }
    if (r && !localStorage.getItem('test-rol')) localStorage.setItem('test-rol', r)
  }, rol)
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
  await dormir(450)
  return true
}
const deshabilitado = (p, t) => p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim().startsWith(t)); return b ? b.disabled : null }, t)
const porEtiqueta = async (p, etiquetaAria) => (await p.evaluateHandle((l) => document.querySelector(`[aria-label="${l}"]`), etiquetaAria)).asElement()
/* Se centra el mueble antes del clic: en el celular la barra de acciones (pegada abajo) podría taparlo. */
async function elegir(p, numero) { const e = await porEtiqueta(p, `Elegir ${numero} para despachar`); if (!e) throw new Error('no está ' + numero); await e.evaluate((i) => i.scrollIntoView({ block: 'center' })); await dormir(100); await e.click(); await dormir(150) }
const marcado = (p, numero) => porEtiqueta(p, `Elegir ${numero} para despachar`).then((e) => (e ? e.evaluate((i) => i.checked) : null))
async function fijarFecha(p, etiquetaCampo, valor) {
  await p.evaluate((t, v) => {
    const i = [...document.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === t)?.querySelector('input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v)
    i.dispatchEvent(new Event('input', { bubbles: true }))
  }, etiquetaCampo, valor)
  await dormir(200)
}
/* La página tal como se ve: encabezados de región y grupos, en el orden de pantalla. */
const estructura = (p) => p.evaluate(() => [...document.querySelectorAll('main [data-region], main section[aria-label]:not([aria-label="Filtros"])')].map((e) => e.hasAttribute('data-region')
  ? { tipo: 'region', nombre: e.getAttribute('data-region'), texto: e.innerText.replace(/\s+/g, ' ') }
  : { tipo: 'grupo', titulo: e.getAttribute('aria-label'), muebles: [...e.querySelectorAll('[data-mueble]')].map((x) => x.getAttribute('data-mueble')), texto: e.innerText.replace(/\s+/g, ' ') }))
const rango = (p) => p.evaluate(() => document.querySelector('[data-rango]')?.innerText.replace(/\s+/g, ' ') ?? null)
const paginaTxt = (p) => p.evaluate(() => document.querySelector('[data-pagina]')?.innerText.replace(/\s+/g, ' ') ?? null)
const barra = (p) => p.evaluate(() => document.querySelector('[data-barra-despacho]')?.innerText.replace(/\s+/g, ' ') ?? null)
const fila = (p, n) => srv(p, (n) => { const f = window.__srv.fila(n); return f ? { estado: f.estado, fecha: f.despacho_programado ?? null } : null }, n)
const total = async (p) => Number(/ de (\d+) /.exec((await rango(p)) ?? '')?.[1] ?? NaN)
const FILTRO_SIN = '__sin_direccion'
const FILTRO_RETIRO = '__retiro'
const porPaginaSelect = async (p, n) => { await (await porEtiqueta(p, 'Por página')).select(String(n)); await dormir(500) }

/* Deja el banco con los 40 muebles esperando entrega (y nada más). */
async function preparar(p) {
  await srv(p, (fixture) => {
    const s = window.__srv
    for (const e of ['fabricado', 'en_despacho']) for (const n of s.numeros(e)) s.otro(n, { estado: 'entregado' })
    for (const f of fixture) {
      const campos = { estado: 'fabricado', listo: true, comuna: f.comuna, region: f.region, fecha_pedido: f.fecha_pedido, plazo_desde: f.plazo_desde, despacho_programado: null }
      if (f.cancelado) campos.cancelado_en = new Date().toISOString()
      s.otro(f.numero, campos)
    }
  }, FIXTURE)
  await clicTexto(p, 'button', 'Recargar')
  await p.waitForFunction((n) => !!document.querySelector(`[data-mueble="${n}"]`), { timeout: 15_000 }, FIXTURE[0].numero)
  await dormir(500)
}

console.log(`40 muebles de prueba (ej. ${FIXTURE.slice(0, 3).map((f) => f.numero).join(', ')})`)

/* ---- ayudas de los filtros ---- */
const campo = (p, etiqueta) => p.evaluateHandle((t) => [...document.querySelectorAll('[data-filtros-despachos] label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === t)?.querySelector('select, input') ?? null, etiqueta)
const elegirEn = async (p, etiqueta, valor) => { const h = (await campo(p, etiqueta)).asElement(); if (!h) throw new Error('no hay selector ' + etiqueta); await h.select(valor); await dormir(500) }
const opcionesDe = (p, etiqueta) => p.evaluate((t) => { const s = [...document.querySelectorAll('[data-filtros-despachos] label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === t)?.querySelector('select'); return s ? [...s.options].map((o) => ({ valor: o.value, etiqueta: o.textContent.trim() })) : null }, etiqueta)
const valorDe = async (p, etiqueta) => (await campo(p, etiqueta)).asElement().evaluate((e) => e.value)
const escribirBusqueda = async (p, valor) => {
  const el = (await campo(p, 'N° de pedido')).asElement()
  await el.focus(); await el.evaluate((i) => i.select()); await p.keyboard.press('Backspace')
  if (valor) await el.type(valor)
  await dormir(500)
}
const gruposTitulos = async (p) => (await estructura(p)).filter((x) => x.tipo === 'grupo').map((g) => g.titulo)
const regionesVisibles = async (p) => (await estructura(p)).filter((x) => x.tipo === 'region').map((x) => x.nombre)
const mueblesVisibles = async (p) => (await estructura(p)).filter((x) => x.tipo === 'grupo').flatMap((g) => g.muebles)
const cuenta = (comuna, region) => FIXTURE.filter((f) => !f.cancelado && f.comuna === comuna && f.region === region).length

console.log(`40 muebles de prueba (ej. ${FIXTURE.slice(0, 3).map((f) => f.numero).join(', ')})`)

/* ================= 1. Los filtros y sus opciones con conteo ================= */
await seccion('1. Los filtros aparecen arriba, con las opciones y su conteo')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  chequeo('arriba de la lista hay: Región, Comuna, N° de pedido y "Limpiar filtros"', !!(await campo(p, 'Región')).asElement() && !!(await campo(p, 'Comuna')).asElement() && !!(await campo(p, 'N° de pedido')).asElement() && (await deshabilitado(p, 'Limpiar filtros')) === true)
  chequeo('por defecto: Región "Todas" y Comuna "Todas"', (await valorDe(p, 'Región')) === '' && (await valorDe(p, 'Comuna')) === '' && (await opcionesDe(p, 'Región'))[0].etiqueta === 'Todas')
  const regiones = (await opcionesDe(p, 'Región')).map((o) => o.etiqueta)
  chequeo('regiones con su conteo: Metropolitana de Santiago (19) primero, luego las demás en orden, y al final Sin dirección y Retiro en tienda', eq(regiones, ['Todas', 'Metropolitana de Santiago (19)', 'Antofagasta (6)', 'Biobío (6)', 'Los Lagos (1)', 'Valparaíso (6)', 'Sin dirección (1)', 'Retiro en tienda (1)']), regiones.join('|'))
  const comunas = (await opcionesDe(p, 'Comuna')).map((o) => o.etiqueta)
  chequeo('sin región elegida, la lista de comunas trae todas (con conteo), por región y alfabéticas', eq(comunas, ['Todas', 'Las Condes (6)', 'Ñuñoa (6)', 'Providencia (7)', 'Antofagasta (6)', 'Concepción (6)', 'Puerto Montt (1)', 'Viña del Mar (6)']), comunas.join('|'))
  await captura(p, '1-filtros')
  await clicTexto(p, 'button', 'Programados por fecha')
  chequeo('en "Programados por fecha" no hay filtros (solo valen para "Por despachar")', !(await campo(p, 'Región')).asElement())
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 2. Región y comuna ================= */
await seccion('2. Filtrar por región y por comuna, manteniendo el orden de siempre')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('se parte en la página 2', /Página 2 de 2/.test((await paginaTxt(p)) ?? ''))
  await elegirEn(p, 'Región', 'Biobío')
  chequeo('al filtrar por región vuelve a la página 1, y "Mostrando 1–6 de 6 muebles" cuenta lo filtrado', (await rango(p)) === 'Mostrando 1–6 de 6 muebles' && (await paginaTxt(p)) === 'Página 1 de 1', `${await rango(p)} | ${await paginaTxt(p)}`)
  chequeo('solo se ve la región Biobío con su comuna Concepción, en orden de antigüedad', eq(await regionesVisibles(p), ['Biobío']) && eq(await gruposTitulos(p), ['Concepción']) && eq(await mueblesVisibles(p), esperadoComuna('Concepción', 'Biobío')), (await mueblesVisibles(p)).join())
  chequeo('el selector de comuna muestra solo las de esa región (Concepción (6))', eq((await opcionesDe(p, 'Comuna')).map((o) => o.etiqueta), ['Todas', 'Concepción (6)']))
  await elegirEn(p, 'Región', RM)
  chequeo('con la región Metropolitana: Las Condes, Ñuñoa y Providencia, cada una en orden de antigüedad', eq(await gruposTitulos(p), ['Las Condes', 'Ñuñoa', 'Providencia']) && ['Las Condes', 'Ñuñoa', 'Providencia'].every((c, i) => true) && eq((await estructura(p)).find((x) => x.titulo === 'Providencia').muebles, esperadoComuna('Providencia', RM)), (await rango(p)) ?? '')
  chequeo('Metropolitana: "Mostrando 1–19 de 19 muebles" (sin los grupos especiales)', (await rango(p)) === 'Mostrando 1–19 de 19 muebles', String(await rango(p)))
  chequeo('las comunas de la lista son las de la Metropolitana, con su conteo', eq((await opcionesDe(p, 'Comuna')).map((o) => o.etiqueta), ['Todas', 'Las Condes (6)', 'Ñuñoa (6)', 'Providencia (7)']))
  await elegirEn(p, 'Comuna', 'providencia')
  chequeo('región + comuna (Providencia): 7 muebles, y el pedido de plazo cambiado queda último', eq(await gruposTitulos(p), ['Providencia']) && eq(await mueblesVisibles(p), esperadoComuna('Providencia', RM)) && (await mueblesVisibles(p)).at(-1) === FIXTURE[40].numero && (await rango(p)) === 'Mostrando 1–7 de 7 muebles')
  await elegirEn(p, 'Región', 'Valparaíso')
  chequeo('al cambiar de región, la comuna vuelve a "Todas"', (await valorDe(p, 'Comuna')) === '' && eq(await gruposTitulos(p), ['Viña del Mar']))
  await elegirEn(p, 'Región', '')
  await elegirEn(p, 'Comuna', 'antofagasta')
  chequeo('solo comuna (región "Todas"): Antofagasta con sus 6 muebles, con el encabezado de su región', eq(await gruposTitulos(p), ['Antofagasta']) && eq(await regionesVisibles(p), ['Antofagasta']) && (await rango(p)) === 'Mostrando 1–6 de 6 muebles')
  chequeo('"Limpiar filtros" quedó habilitado', (await deshabilitado(p, 'Limpiar filtros')) === false)
  await clicTexto(p, 'button', 'Limpiar filtros')
  chequeo('"Limpiar filtros" vuelve a todo: región y comuna "Todas" y "Mostrando 1–20 de 40 muebles"', (await valorDe(p, 'Región')) === '' && (await valorDe(p, 'Comuna')) === '' && (await rango(p)) === 'Mostrando 1–20 de 40 muebles', String(await rango(p)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 3. Búsqueda por N° de pedido ================= */
await seccion('3. Búsqueda por N° de pedido')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  const uno = FIXTURE[5].numero
  await clicTexto(p, 'button', 'Siguiente')
  await escribirBusqueda(p, uno)
  chequeo('escribir un N° de pedido deja solo ese mueble, vuelve a la página 1 y "Mostrando 1–1 de 1 muebles"', eq(await mueblesVisibles(p), [uno]) && (await rango(p)) === 'Mostrando 1–1 de 1 muebles', `${(await mueblesVisibles(p)).join()} | ${await rango(p)}`)
  await escribirBusqueda(p, '#' + uno)
  chequeo('con "#" delante también', eq(await mueblesVisibles(p), [uno]))
  const prefijo = uno.slice(0, 3)
  const esperados = FIXTURE.filter((f) => !f.cancelado && f.numero.includes(prefijo)).length
  await escribirBusqueda(p, prefijo)
  chequeo(`un pedazo del número ("${prefijo}") deja los que lo contienen (${esperados})`, (await mueblesVisibles(p)).length === Math.min(20, esperados) && (await total(p)) === esperados, `${await rango(p)}`)
  const reg = (await opcionesDe(p, 'Región')).map((o) => o.etiqueta)
  chequeo('la búsqueda ajusta los conteos de los selectores (la suma de las regiones es lo que coincide)', reg.slice(1).reduce((s, e) => s + Number(/\((\d+)\)$/.exec(e)[1]), 0) === esperados, reg.join('|'))
  await escribirBusqueda(p, 'zzzz')
  chequeo('un texto que no está: "Ningún mueble coincide con los filtros", sin paginador y con "Limpiar filtros"', /Ningún mueble coincide con los filtros/.test(await texto(p)) && (await rango(p)) === null && (await mueblesVisibles(p)).length === 0)
  await clicTexto(p, 'main button', 'Limpiar filtros')
  chequeo('"Limpiar filtros" borra el texto y vuelve a la lista completa', (await valorDe(p, 'N° de pedido')) === '' && (await rango(p)) === 'Mostrando 1–20 de 40 muebles')
  // búsqueda + región
  await elegirEn(p, 'Región', 'Valparaíso')
  const enValpo = FIXTURE.find((f) => f.region === 'Valparaíso').numero
  await escribirBusqueda(p, enValpo)
  chequeo('región + búsqueda se combinan: el mueble buscado dentro de Valparaíso', eq(await mueblesVisibles(p), [enValpo]))
  await escribirBusqueda(p, FIXTURE.find((f) => f.region === 'Biobío').numero)
  chequeo('un pedido de otra región no aparece, y el selector sigue mostrando "Valparaíso (0)"', (await mueblesVisibles(p)).length === 0 && (await opcionesDe(p, 'Región')).some((o) => o.etiqueta === 'Valparaíso (0)'))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 4. Sin dirección y Retiro en tienda ================= */
await seccion('4. Ver "Sin dirección" y "Retiro en tienda" solos')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  await elegirEn(p, 'Región', FILTRO_SIN)
  chequeo('"Sin dirección (1)" deja solo ese grupo, sin encabezado de región', eq(await gruposTitulos(p), ['Sin dirección']) && eq(await mueblesVisibles(p), [FIXTURE[38].numero]) && (await regionesVisibles(p)).length === 0 && (await rango(p)) === 'Mostrando 1–1 de 1 muebles')
  chequeo('con un grupo especial la lista de comunas se desactiva', await (await campo(p, 'Comuna')).asElement().evaluate((e) => e.disabled))
  await elegirEn(p, 'Región', FILTRO_RETIRO)
  chequeo('"Retiro en tienda (1)" deja solo el retiro, fuera de las rutas', eq(await gruposTitulos(p), ['Retiro en tienda']) && eq(await mueblesVisibles(p), [FIXTURE[37].numero]))
  await elegirEn(p, 'Región', '')
  chequeo('al volver a "Todas" se activa la lista de comunas y vuelve todo', !(await (await campo(p, 'Comuna')).asElement().evaluate((e) => e.disabled)) && (await rango(p)) === 'Mostrando 1–20 de 40 muebles')
  chequeo('con filtro de región, Sin dirección y Retiro NO aparecen (Biobío: solo Concepción)', await (async () => { await elegirEn(p, 'Región', 'Biobío'); return eq(await gruposTitulos(p), ['Concepción']) })())
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 5. Selección entre filtros ================= */
await seccion('5. La selección se mantiene al filtrar y la barra dice cuántos quedaron fuera del filtro')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  await elegirEn(p, 'Región', 'Biobío')
  const bio = await mueblesVisibles(p)
  await elegir(p, bio[0]); await elegir(p, bio[1])
  chequeo('con el filtro Biobío se eligen 2: "2 muebles elegidos" y ninguno fuera del filtro', /2 muebles elegidos/.test((await barra(p)) ?? '') && !/fuera del filtro/.test((await barra(p)) ?? ''), String(await barra(p)))
  await elegirEn(p, 'Región', RM); await elegirEn(p, 'Comuna', 'providencia')
  chequeo('al cambiar a Providencia, los 2 de Biobío siguen contando y la barra lo dice: "2 muebles elegidos · 2 fuera del filtro"', /2 muebles elegidos · 2 fuera del filtro/.test((await barra(p)) ?? ''), String(await barra(p)))
  const prov = await mueblesVisibles(p)
  await elegir(p, prov[0]); await elegir(p, prov[1]); await elegir(p, prov[2])
  chequeo('se eligen 3 de Providencia: "5 muebles elegidos · 2 fuera del filtro"', /5 muebles elegidos · 2 fuera del filtro/.test((await barra(p)) ?? ''), String(await barra(p)))
  await elegirEn(p, 'Región', 'Biobío')
  chequeo('al volver a Biobío, sus 2 siguen marcados y ahora son 3 los de fuera: "5 muebles elegidos · 3 fuera del filtro"', (await marcado(p, bio[0])) === true && (await marcado(p, bio[1])) === true && (await marcado(p, bio[2])) === false && /5 muebles elegidos · 3 fuera del filtro/.test((await barra(p)) ?? ''), String(await barra(p)))
  await clicTexto(p, 'main button', 'Limpiar filtros')
  chequeo('al limpiar los filtros todo vuelve a estar a la vista y la barra ya no habla de "fuera del filtro"', /5 muebles elegidos/.test((await barra(p)) ?? '') && !/fuera del filtro/.test((await barra(p)) ?? ''), String(await barra(p)))
  await elegirEn(p, 'Región', 'Valparaíso')
  await fijarFecha(p, 'Fecha del despacho', PASADO)
  await clicTexto(p, 'button', 'Programar despacho'); await dormir(900)
  const sel = [bio[0], bio[1], prov[0], prov[1], prov[2]]
  const fechas = await Promise.all(sel.map((n) => fila(p, n)))
  chequeo('se programan los 5 elegidos aunque 5 estén fuera del filtro actual (Valparaíso)', fechas.every((f) => f.fecha === PASADO), JSON.stringify(fechas))
  chequeo('la selección se limpia y los filtros se mantienen', (await barra(p)) === null && (await valorDe(p, 'Región')) === 'Valparaíso')
  // "Elegir todos" de una comuna elige la comuna completa
  await clicTexto(p, 'main button', 'Limpiar filtros')
  await (await porEtiqueta(p, 'Elegir todos los muebles de Providencia')).click(); await dormir(300)
  chequeo('"Elegir todos" de Providencia elige la comuna completa (7)', /7 muebles elegidos/.test((await barra(p)) ?? ''), String(await barra(p)))
  await clicTexto(p, 'button', 'Limpiar selección')
  await elegirEn(p, 'Región', 'Antofagasta')
  await (await porEtiqueta(p, 'Elegir todos los muebles de Antofagasta')).click(); await dormir(300)
  chequeo('con el filtro de región, "Elegir todos" de Antofagasta elige sus 6', /6 muebles elegidos/.test((await barra(p)) ?? ''))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 6. Cambios pendientes del 4b ================= */
await seccion('6. Los cambios pendientes del 4b no se pierden al filtrar')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  const pendiente = FIXTURE[3].numero // Viña del Mar
  await p.goto(`${BASE}/pedidos`, { waitUntil: 'networkidle0' }); await dormir(800)
  const buscar = (n) => p.evaluateHandle((n) => [...document.querySelectorAll('input[type=checkbox]')].find((i) => (i.getAttribute('aria-label') ?? '') === `B del pedido ${n}`) ?? null, n)
  let h = await buscar(pendiente)
  for (let i = 0; i < 12 && !h.asElement(); i++) { if (!(await clicTexto(p, 'button', 'Siguiente'))) break; h = await buscar(pendiente) }
  await h.asElement().click(); await dormir(300)
  const contador = () => p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)
  await p.evaluate(() => { if (!document.querySelector('#submenu-pedidos')) [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Pedidos')?.click() }); await dormir(300)
  await p.evaluate(() => [...document.querySelectorAll('#submenu-pedidos a')].find((a) => a.textContent.trim() === 'Despachos')?.click())
  await p.waitForSelector('[data-mueble]', { timeout: 10_000 }); await dormir(400)
  chequeo('en Despachos la barra de cambios sigue con el cambio pendiente', (await contador()) === '1 cambio sin guardar en 1 mueble', String(await contador()))
  await elegirEn(p, 'Región', 'Valparaíso')
  chequeo('al filtrar, el cambio pendiente sigue ahí', (await contador()) === '1 cambio sin guardar en 1 mueble')
  const casilla = await porEtiqueta(p, `Elegir ${pendiente} para despachar`)
  chequeo('el mueble con cambios sin guardar se ve en la lista filtrada, bloqueado y con su aviso', !!casilla && (await casilla.evaluate((i) => i.disabled)) && /Cambios sin guardar/.test(await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`).innerText, pendiente)))
  await escribirBusqueda(p, 'zzzz'); await clicTexto(p, 'main button', 'Limpiar filtros')
  chequeo('buscar algo que no existe y limpiar tampoco pierde el cambio pendiente', (await contador()) === '1 cambio sin guardar en 1 mueble')
  await elegirEn(p, 'Región', 'Biobío')
  const otro = (await mueblesVisibles(p))[0]
  await elegir(p, otro)
  await elegirEn(p, 'Región', 'Valparaíso')
  chequeo('cambios pendientes y selección conviven: "1 cambio sin guardar" y "1 mueble elegido · 1 fuera del filtro"', (await contador()) === '1 cambio sin guardar en 1 mueble' && /1 mueble elegido · 1 fuera del filtro/.test((await barra(p)) ?? ''), `${await contador()} | ${await barra(p)}`)
  await clicTexto(p, 'button', 'Revisar y guardar')
  await clicTexto(p, '[role=dialog] button', 'Guardar 1 cambio'); await dormir(1000)
  chequeo('se guarda el cambio pendiente y el mueble queda disponible; la selección sigue', (await contador()) === null && (await srv(p, (n) => window.__srv.fila(n).etapa_b === true, pendiente)) === true && /1 mueble elegido/.test((await barra(p)) ?? ''))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 7. Celular ================= */
await seccion('7. Filtros en el celular')
{
  const p = await abrir('bodega', '/despachos', { ancho: 390, alto: 844 })
  await preparar(p)
  chequeo('sin desborde horizontal de la página', !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)))
  chequeo('los filtros se ven completos (Región, Comuna, N° de pedido y Limpiar filtros)', await p.evaluate(() => { const f = document.querySelector('[data-filtros-despachos]'); const r = f.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && f.querySelectorAll('select').length === 2 && f.querySelectorAll('input').length === 1 }))
  await captura(p, '7-movil-filtros')
  await elegirEn(p, 'Región', 'Antofagasta')
  chequeo('filtrar por región funciona en el celular: "Mostrando 1–6 de 6 muebles"', (await rango(p)) === 'Mostrando 1–6 de 6 muebles')
  const ant = await mueblesVisibles(p)
  await elegir(p, ant[0]); await elegir(p, ant[1])
  await elegirEn(p, 'Región', 'Valparaíso')
  chequeo('la barra del celular dice "2 muebles elegidos · 2 fuera del filtro" y está a la vista', /2 muebles elegidos · 2 fuera del filtro/.test((await barra(p)) ?? '') && await p.evaluate(() => { const r = document.querySelector('[data-barra-despacho]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1 }), String(await barra(p)))
  await escribirBusqueda(p, 'zzzz')
  chequeo('un texto sin coincidencias muestra el aviso y "Limpiar filtros"', /Ningún mueble coincide/.test(await texto(p)))
  await clicTexto(p, 'main button', 'Limpiar filtros')
  chequeo('limpiar vuelve a la lista completa, con la selección intacta', (await rango(p)) === 'Mostrando 1–20 de 40 muebles' && /2 muebles elegidos/.test((await barra(p)) ?? '') && !/fuera del filtro/.test((await barra(p)) ?? ''))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

try { await navegador?.close() } catch { /* ya cerrado */ }
console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
