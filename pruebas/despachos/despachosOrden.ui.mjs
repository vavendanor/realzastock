/* Orden y paginador de /despachos (pestaña "Por despachar") en Chrome real contra el banco de pruebas (ver
   pruebas/README.md): regiones, comunas, antigüedad, grupos cortados entre páginas, selección y cambios pendientes
   entre páginas, y celular. Los 40 muebles de la prueba se arman con pedidos de octubre. */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5180'
const CAPTURAS = process.argv[2] ?? join(tmpdir(), 'capturas-despachos-orden')
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
async function elegir(p, numero) { const e = await porEtiqueta(p, `Elegir ${numero} para despachar`); if (!e) throw new Error('no está ' + numero); await e.click(); await dormir(150) }
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
const estructura = (p) => p.evaluate(() => [...document.querySelectorAll('main [data-region], main section[aria-label]')].map((e) => e.hasAttribute('data-region')
  ? { tipo: 'region', nombre: e.getAttribute('data-region'), texto: e.innerText.replace(/\s+/g, ' ') }
  : { tipo: 'grupo', titulo: e.getAttribute('aria-label'), muebles: [...e.querySelectorAll('[data-mueble]')].map((x) => x.getAttribute('data-mueble')), texto: e.innerText.replace(/\s+/g, ' ') }))
const rango = (p) => p.evaluate(() => document.querySelector('[data-rango]')?.innerText.replace(/\s+/g, ' ') ?? null)
const paginaTxt = (p) => p.evaluate(() => document.querySelector('[data-pagina]')?.innerText.replace(/\s+/g, ' ') ?? null)
const barra = (p) => p.evaluate(() => document.querySelector('[data-barra-despacho]')?.innerText.replace(/\s+/g, ' ') ?? null)
const fila = (p, n) => srv(p, (n) => { const f = window.__srv.fila(n); return f ? { estado: f.estado, fecha: f.despacho_programado ?? null } : null }, n)
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

/* ================= 1. Orden: región, comuna, antigüedad ================= */
await seccion('1. Orden por región, comuna y antigüedad (página 1)')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  const e1 = await estructura(p)
  const nombres = e1.map((x) => (x.tipo === 'region' ? `R:${x.nombre}` : x.titulo))
  chequeo('página 1: región Metropolitana arriba, con sus comunas en orden alfabético, y después la región Antofagasta', eq(nombres, ['R:Metropolitana de Santiago', 'Las Condes', 'Ñuñoa', 'Providencia', 'R:Antofagasta', 'Antofagasta']), nombres.join('|'))
  chequeo('el encabezado de región se ve: "Región Metropolitana de Santiago · 19 muebles"', /Región Metropolitana de Santiago.*19 muebles/.test(e1[0].texto), e1[0].texto)
  chequeo('las comunas de la Metropolitana, del pedido más antiguo al más nuevo (por fecha del pedido o inicio del plazo)', ['Las Condes', 'Ñuñoa', 'Providencia'].every((c) => eq(e1.find((x) => x.titulo === c).muebles, esperadoComuna(c, RM))), JSON.stringify(e1.filter((x) => x.tipo === 'grupo').map((x) => x.muebles.join())))
  const prov = e1.find((x) => x.titulo === 'Providencia').muebles
  chequeo('el pedido antiguo con el plazo contado desde mucho después queda ÚLTIMO de Providencia', prov.at(-1) === FIXTURE[40].numero && prov.length === 7, prov.join())
  chequeo('el orden no coincide con el número de pedido (la prueba distingue ambos criterios)', !eq(prov, [...prov].sort((a, b) => Number(a) - Number(b))))
  await captura(p, '1-pagina-1')
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 2. Paginador: 20 por página y grupos cortados ================= */
await seccion('2. Paginador: 20 por página, 50 y 100, y un grupo cortado entre páginas')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  chequeo('"Mostrando 1–20 de 40 muebles", "Página 1 de 2" y Anterior deshabilitado', (await rango(p)) === 'Mostrando 1–20 de 40 muebles' && (await paginaTxt(p)) === 'Página 1 de 2' && (await deshabilitado(p, 'Anterior')) === true && (await deshabilitado(p, 'Siguiente')) === false, `${await rango(p)} | ${await paginaTxt(p)}`)
  const cuenta1 = (await estructura(p)).filter((x) => x.tipo === 'grupo').reduce((s, g) => s + g.muebles.length, 0)
  chequeo('la página 1 muestra exactamente 20 muebles', cuenta1 === 20, String(cuenta1))
  const e1 = await estructura(p)
  const ant1 = e1.find((x) => x.titulo === 'Antofagasta')
  chequeo('Antofagasta queda cortada: en la página 1 trae 1 de 6 y avisa que sigue', ant1.muebles.length === 1 && /1 de 6 muebles · sigue en la página siguiente/.test(ant1.texto) && !/continuación/.test(ant1.texto), ant1.texto)
  await clicTexto(p, 'button', 'Siguiente')
  const e2 = await estructura(p)
  const n2 = e2.map((x) => (x.tipo === 'region' ? `R:${x.nombre}` : x.titulo))
  chequeo('página 2: repite el encabezado de Antofagasta (región y grupo, como "continuación") y sigue con Biobío, Los Lagos y Valparaíso; Sin dirección y Retiro al final, sin región', eq(n2, ['R:Antofagasta', 'Antofagasta', 'R:Biobío', 'Concepción', 'R:Los Lagos', 'Puerto Montt', 'R:Valparaíso', 'Viña del Mar', 'Sin dirección', 'Retiro en tienda']), n2.join('|'))
  const ant2 = e2.find((x) => x.titulo === 'Antofagasta')
  chequeo('la continuación trae los 5 restantes, con la etiqueta "continuación" y "5 de 6 muebles"', ant2.muebles.length === 5 && /continuación/.test(ant2.texto) && /5 de 6 muebles/.test(ant2.texto) && /continuación/.test(e2[0].texto), `${ant2.texto} | ${e2[0].texto}`)
  chequeo('entre las 2 páginas, los 6 de Antofagasta aparecen una vez y en el orden de antigüedad', eq([...ant1.muebles, ...ant2.muebles], esperadoComuna('Antofagasta', 'Antofagasta')), [...ant1.muebles, ...ant2.muebles].join())
  chequeo('"Mostrando 21–40 de 40 muebles", "Página 2 de 2" y Siguiente deshabilitado', (await rango(p)) === 'Mostrando 21–40 de 40 muebles' && (await paginaTxt(p)) === 'Página 2 de 2' && (await deshabilitado(p, 'Siguiente')) === true && (await deshabilitado(p, 'Anterior')) === false)
  chequeo('"Sin dirección" y "Retiro en tienda" siguen al final y fuera de las regiones', e2.at(-2).titulo === 'Sin dirección' && e2.at(-1).titulo === 'Retiro en tienda')
  await captura(p, '2-pagina-2')
  const todos = [...e1, ...e2].filter((x) => x.tipo === 'grupo').flatMap((g) => g.muebles)
  chequeo('entre las 2 páginas están los 40 muebles, cada uno una sola vez', todos.length === 40 && new Set(todos).size === 40 && DESPACHABLES.every((f) => todos.includes(f.numero)))
  chequeo('no aparece el pedido cancelado', !todos.includes(FIXTURE[39].numero))
  await clicTexto(p, 'button', 'Anterior')
  chequeo('"Anterior" vuelve a la página 1', (await rango(p)) === 'Mostrando 1–20 de 40 muebles')
  // Cambiar el tamaño
  const opciones = await p.evaluate(() => [...document.querySelector('[aria-label="Por página"]').options].map((o) => o.value))
  chequeo('el selector ofrece 20, 50 y 100', eq(opciones, ['20', '50', '100']), opciones.join())
  await clicTexto(p, 'button', 'Siguiente')
  await porPaginaSelect(p, 50)
  chequeo('50 por página: una sola página con los 40, sin cortes ni "continuación", y vuelve a la página 1', (await rango(p)) === 'Mostrando 1–40 de 40 muebles' && (await paginaTxt(p)) === 'Página 1 de 1' && (await deshabilitado(p, 'Siguiente')) === true && !/continuación/.test((await estructura(p)).map((x) => x.texto).join(' ')))
  await porPaginaSelect(p, 100)
  chequeo('100 por página: igual, los 40 juntos', (await rango(p)) === 'Mostrando 1–40 de 40 muebles')
  await porPaginaSelect(p, 20)
  chequeo('de vuelta a 20 por página: 1–20', (await rango(p)) === 'Mostrando 1–20 de 40 muebles')
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 3. Selección entre páginas ================= */
await seccion('3. La selección se mantiene entre páginas y la barra cuenta todo')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  const e1 = await estructura(p)
  const prov = e1.find((x) => x.titulo === 'Providencia').muebles
  await elegir(p, prov[0]); await elegir(p, prov[1])
  chequeo('2 elegidos en la página 1: "2 muebles elegidos"', /2 muebles elegidos/.test((await barra(p)) ?? ''))
  await clicTexto(p, 'button', 'Siguiente')
  const e2 = await estructura(p)
  const bio = e2.find((x) => x.titulo === 'Concepción').muebles
  await elegir(p, bio[0]); await elegir(p, bio[1]); await elegir(p, bio[2])
  chequeo('al pasar a la página 2 la barra sigue y suma lo nuevo: "5 muebles elegidos"', /5 muebles elegidos/.test((await barra(p)) ?? ''), String(await barra(p)))
  await clicTexto(p, 'button', 'Anterior')
  chequeo('al volver a la página 1, los 2 siguen marcados y la barra cuenta los 5', (await marcado(p, prov[0])) === true && (await marcado(p, prov[1])) === true && (await marcado(p, prov[2])) === false && /5 muebles elegidos/.test((await barra(p)) ?? ''))
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('...y en la página 2 los 3 siguen marcados', (await marcado(p, bio[0])) === true && (await marcado(p, bio[2])) === true && (await marcado(p, bio[3])) === false)
  // Programar con la selección repartida en las dos páginas
  await fijarFecha(p, 'Fecha del despacho', PASADO)
  await clicTexto(p, 'button', 'Programar despacho'); await dormir(900)
  const fechas = await Promise.all([prov[0], prov[1], bio[0], bio[1], bio[2]].map((n) => fila(p, n)))
  chequeo('se programan los 5 muebles de las dos páginas con una sola acción', fechas.every((f) => f.fecha === PASADO), JSON.stringify(fechas))
  chequeo('la selección se limpia y se queda en la misma página (la 2)', (await barra(p)) === null && /Página 2 de 2/.test((await paginaTxt(p)) ?? ''))
  // "Elegir todos" de un grupo cortado: vale para el grupo completo
  await clicTexto(p, 'button', 'Anterior')
  await (await porEtiqueta(p, 'Elegir todos los muebles de Antofagasta')).click(); await dormir(300)
  chequeo('"Elegir todos" de Antofagasta (1 visible de 6) elige los 6, también los de la página siguiente', /6 muebles elegidos/.test((await barra(p)) ?? ''), String(await barra(p)))
  await clicTexto(p, 'button', 'Siguiente')
  const ant2 = (await estructura(p)).find((x) => x.titulo === 'Antofagasta').muebles
  chequeo('en la página 2, los 5 restantes aparecen marcados y su casilla de grupo también', (await Promise.all(ant2.map((n) => marcado(p, n)))).every(Boolean) && (await (await porEtiqueta(p, 'Elegir todos los muebles de Antofagasta')).evaluate((i) => i.checked)))
  await clicTexto(p, 'button', 'Limpiar selección')
  chequeo('"Limpiar selección" quita todo lo elegido, en cualquier página', (await barra(p)) === null && (await Promise.all(ant2.map((n) => marcado(p, n)))).every((x) => x === false))
  // Marcar despachado desde la página 2 un mueble elegido en la 1: la lista se acorta y la página se corrige
  await clicTexto(p, 'button', 'Anterior')
  const unoP1 = (await estructura(p)).find((x) => x.titulo === 'Las Condes').muebles[0]
  await elegir(p, unoP1)
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('un mueble elegido en la página 1 sigue contando estando en la 2', /1 mueble elegido/.test((await barra(p)) ?? ''))
  await clicTexto(p, 'button', 'Marcar como despachado')
  await clicTexto(p, '[role=dialog] button', 'Marcar 1 despachados'); await dormir(1000)
  chequeo('se despacha el mueble elegido en la otra página y la lista queda en 39', (await fila(p, unoP1)).estado === 'en_despacho' && /de 39 muebles/.test((await rango(p)) ?? ''), String(await rango(p)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 4. Cambios pendientes del 4b entre páginas ================= */
await seccion('4. Los cambios pendientes del 4b no se pierden al cambiar de página')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  const pendiente = FIXTURE[3].numero // Viña del Mar: queda en la página 2 de Despachos
  await p.goto(`${BASE}/pedidos`, { waitUntil: 'networkidle0' }); await dormir(800)
  const buscar = (n) => p.evaluateHandle((n) => [...document.querySelectorAll('input[type=checkbox]')].find((i) => (i.getAttribute('aria-label') ?? '') === `B del pedido ${n}`) ?? null, n)
  let h = await buscar(pendiente)
  for (let i = 0; i < 12 && !h.asElement(); i++) { if (!(await clicTexto(p, 'button', 'Siguiente'))) break; h = await buscar(pendiente) }
  await h.asElement().click(); await dormir(300)
  const contador = () => p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)
  chequeo('en Pedidos se marca una casilla y queda pendiente', (await contador()) === '1 cambio sin guardar en 1 mueble', await contador())
  await clicTexto(p, 'button', 'Siguiente'); await clicTexto(p, 'button', 'Anterior')
  chequeo('en Pedidos, cambiar de página y volver NO pierde el cambio pendiente', (await contador()) === '1 cambio sin guardar en 1 mueble')
  await clicTexto(p, 'button', 'Siguiente')
  const otra = await p.evaluateHandle(() => [...document.querySelectorAll('input[type=checkbox]')].find((i) => /^I del pedido /.test(i.getAttribute('aria-label') ?? '')) ?? null)
  await otra.asElement().click(); await dormir(300)
  chequeo('un cambio más en otra página: la barra cuenta los de todas las páginas ("2 cambios")', /^2 cambios sin guardar en 2 muebles$/.test((await contador()) ?? ''), await contador())
  await p.evaluate(() => { if (!document.querySelector('#submenu-pedidos')) [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Pedidos')?.click() }); await dormir(300)
  await p.evaluate(() => [...document.querySelectorAll('#submenu-pedidos a')].find((a) => a.textContent.trim() === 'Despachos')?.click())
  await p.waitForSelector('[data-mueble]', { timeout: 10_000 }); await dormir(400)
  chequeo('ir a Despachos NO pide confirmación y la barra de cambios sigue con sus 2', ruta(p) === '/despachos' && !(await p.evaluate(() => document.querySelector('[role=dialog]'))) && /^2 cambios/.test((await contador()) ?? ''), `${ruta(p)} ${await contador()}`)
  await clicTexto(p, 'button', 'Siguiente')
  const casilla = await porEtiqueta(p, `Elegir ${pendiente} para despachar`)
  chequeo('en la página 2 de Despachos, el mueble con cambios sin guardar no se puede elegir y lo dice', !!casilla && (await casilla.evaluate((i) => i.disabled)) && /Cambios sin guardar/.test(await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`).innerText, pendiente)))
  const otros = (await estructura(p)).find((x) => x.titulo === 'Concepción').muebles.filter((n) => n !== pendiente)
  await elegir(p, otros[0])
  await clicTexto(p, 'button', 'Anterior'); await clicTexto(p, 'button', 'Siguiente')
  chequeo('cambiar de página no toca los cambios pendientes ni la selección', /^2 cambios/.test((await contador()) ?? '') && /1 mueble elegido/.test((await barra(p)) ?? ''))
  await clicTexto(p, 'button', 'Revisar y guardar')
  await clicTexto(p, '[role=dialog] button', 'Guardar 2 cambios'); await dormir(1000)
  chequeo('se guardan los 2 cambios desde la barra y el mueble vuelve a poder elegirse', (await contador()) === null && (await srv(p, (n) => window.__srv.fila(n).etapa_b === true, pendiente)) === true && !(await (await porEtiqueta(p, `Elegir ${pendiente} para despachar`)).evaluate((i) => i.disabled)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 5. Celular ================= */
await seccion('5. Orden y paginador en el celular')
{
  const p = await abrir('bodega', '/despachos', { ancho: 390, alto: 844 })
  await preparar(p)
  chequeo('sin desborde horizontal de la página', !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)))
  const e = await estructura(p)
  chequeo('en el celular también: región Metropolitana arriba y sus comunas en orden', e[0].tipo === 'region' && /Metropolitana de Santiago/.test(e[0].texto) && eq(e.filter((x) => x.tipo === 'grupo').slice(0, 3).map((g) => g.titulo), ['Las Condes', 'Ñuñoa', 'Providencia']))
  chequeo('el paginador se ve completo: "Mostrando 1–20 de 40 muebles" y sus botones', (await rango(p)) === 'Mostrando 1–20 de 40 muebles' && (await p.evaluate(() => { const n = document.querySelector('[data-paginador]'); return !!n && n.scrollWidth <= window.innerWidth + 2 })))
  await p.evaluate(() => document.querySelector('[data-paginador]').scrollIntoView({ block: 'center' })); await dormir(200)
  await captura(p, '5-movil-paginador')
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('"Siguiente" funciona con el dedo: "Mostrando 21–40 de 40 muebles"', (await rango(p)) === 'Mostrando 21–40 de 40 muebles')
  const grupos = (await estructura(p)).filter((x) => x.tipo === 'grupo')
  await elegir(p, grupos[1].muebles[0])
  await clicTexto(p, 'button', 'Anterior')
  const g1 = (await estructura(p)).filter((x) => x.tipo === 'grupo')
  await elegir(p, g1[0].muebles[0])
  chequeo('la selección repartida en 2 páginas se cuenta junta en la barra', /2 muebles elegidos/.test((await barra(p)) ?? ''), String(await barra(p)))
  chequeo('la barra está a la vista (pegada abajo)', await p.evaluate(() => { const r = document.querySelector('[data-barra-despacho]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1 }))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

try { await navegador?.close() } catch { /* ya cerrado */ }
console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
