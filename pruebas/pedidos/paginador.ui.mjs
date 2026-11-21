/* Paginador de /pedidos (y de la tabla de /hojas/nueva) en Chrome real contra el banco de pruebas (ver
   pruebas/README.md): 20 por página con 50 y 100, "Mostrando X–Y de Z", vuelta a la página 1 al cambiar un
   filtro, cambios pendientes entre páginas y celular. */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5180'
const CAPTURAS = process.argv[2] ?? join(tmpdir(), 'capturas-pedidos-paginador')
mkdirSync(CAPTURAS, { recursive: true })
const datos = JSON.parse(readFileSync(fileURLToPath(new URL('../arnes/datos.json', import.meta.url)), 'utf8')).ordenes

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
  await dormir(800)
  return p
}
const texto = (p) => p.evaluate(() => document.body.innerText)
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
const rango = (p) => p.evaluate(() => document.querySelector('[data-rango]')?.innerText.replace(/\s+/g, ' ') ?? null)
const paginaTxt = (p) => p.evaluate(() => document.querySelector('[data-pagina]')?.innerText.replace(/\s+/g, ' ') ?? null)
const filas = (p) => p.evaluate(() => document.querySelectorAll('tbody tr').length)
const primeraFila = (p) => p.evaluate(() => document.querySelector('tbody tr td:nth-child(1)')?.innerText.split(String.fromCharCode(10))[0].trim() ?? null)
const tarjetas = (p) => p.evaluate(() => document.querySelectorAll('input[aria-label^="B del pedido "]').length)
const total = async (p) => Number(/ de (\d+) /.exec((await rango(p)) ?? '')?.[1] ?? NaN)
const porPaginaSelect = async (p, n) => { await (await p.evaluateHandle(() => document.querySelector('[aria-label="Por página"]'))).asElement().select(String(n)); await dormir(500) }
const selectEstado = async (p, valor) => {
  const sel = await p.evaluateHandle(() => [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent.trim() === 'Por fabricar') && [...x.options].some((o) => o.textContent.trim() === 'Fabricado')) ?? null)
  await sel.asElement().select(valor); await dormir(800)
}
const contador = (p) => p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)

const noAdicionales = datos.filter((o) => !o.es_adicional)
const N = noAdicionales.length
const N_POR_FABRICAR = noAdicionales.filter((o) => o.estado === 'por_fabricar').length
const ultimaPagina = (n, por) => Math.max(1, Math.ceil(n / por))

console.log(`Pedidos: ${N} órdenes en la lista (sin adicionales); por fabricar: ${N_POR_FABRICAR}`)

/* ================= 1. Paginador de Pedidos ================= */
await seccion('1. Pedidos: 20 por página, 50 y 100, Anterior y Siguiente')
{
  const p = await abrir('administrador', '/pedidos')
  const n = await total(p)
  chequeo(`la lista completa trae ${N} órdenes (las mismas del servidor de prueba, sin adicionales)`, n === N, `${n} vs ${N}`)
  chequeo(`"Mostrando 1–20 de ${N} órdenes", "Página 1 de ${ultimaPagina(N, 20)}" y Anterior deshabilitado`, (await rango(p)) === `Mostrando 1–20 de ${N} órdenes` && (await paginaTxt(p)) === `Página 1 de ${ultimaPagina(N, 20)}` && (await deshabilitado(p, 'Anterior')) === true)
  chequeo('la tabla muestra exactamente 20 filas', (await filas(p)) === 20, String(await filas(p)))
  const primera1 = await primeraFila(p)
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('"Siguiente": "Mostrando 21–40" y otras 20 filas, distintas de las de la página 1', (await rango(p)) === `Mostrando 21–40 de ${N} órdenes` && (await filas(p)) === 20 && (await primeraFila(p)) !== primera1, `${await rango(p)} ${await filas(p)}`)
  chequeo('en la página 2 "Anterior" ya está habilitado', (await deshabilitado(p, 'Anterior')) === false)
  for (let i = 2; i < ultimaPagina(N, 20); i++) await clicTexto(p, 'button', 'Siguiente')
  const resto = N - 20 * (ultimaPagina(N, 20) - 1)
  chequeo(`la última página trae solo lo que queda (${resto}), dice "Mostrando ${20 * (ultimaPagina(N, 20) - 1) + 1}–${N} de ${N}" y Siguiente deshabilitado`, (await filas(p)) === resto && (await rango(p)) === `Mostrando ${20 * (ultimaPagina(N, 20) - 1) + 1}–${N} de ${N} órdenes` && (await deshabilitado(p, 'Siguiente')) === true, `${await filas(p)} ${await rango(p)}`)
  await captura(p, '1-pedidos-ultima')
  const opciones = await p.evaluate(() => [...document.querySelector('[aria-label="Por página"]').options].map((o) => o.value).join())
  chequeo('el selector ofrece 20, 50 y 100', opciones === '20,50,100', opciones)
  await porPaginaSelect(p, 50)
  chequeo('50 por página: vuelve a la página 1 con 50 filas', (await rango(p)) === `Mostrando 1–50 de ${N} órdenes` && (await filas(p)) === 50, `${await rango(p)} ${await filas(p)}`)
  await porPaginaSelect(p, 100)
  chequeo('100 por página: 100 filas', (await filas(p)) === Math.min(100, N) && (await rango(p)) === `Mostrando 1–${Math.min(100, N)} de ${N} órdenes`)
  await clicTexto(p, 'button', 'Siguiente')
  chequeo(`con 100 por página, la página 2 trae las ${N - 100} que faltan`, (await filas(p)) === N - 100 && (await rango(p)) === `Mostrando 101–${N} de ${N} órdenes`, `${await filas(p)} ${await rango(p)}`)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 2. Con filtros ================= */
await seccion('2. El paginador se aplica DESPUÉS de los filtros y vuelve a la página 1 al cambiarlos')
{
  const p = await abrir('administrador', '/pedidos')
  await clicTexto(p, 'button', 'Siguiente'); await clicTexto(p, 'button', 'Siguiente')
  chequeo('se parte en la página 3', (await paginaTxt(p)) === `Página 3 de ${ultimaPagina(N, 20)}`)
  await selectEstado(p, 'por_fabricar')
  chequeo(`al filtrar por estado "Por fabricar": vuelve a la página 1 y el total es el de los filtrados (${N_POR_FABRICAR})`, (await paginaTxt(p)) === `Página 1 de ${ultimaPagina(N_POR_FABRICAR, 20)}` && (await rango(p)) === `Mostrando 1–${Math.min(20, N_POR_FABRICAR)} de ${N_POR_FABRICAR} órdenes`, `${await paginaTxt(p)} ${await rango(p)}`)
  chequeo('las filas son solo de ese estado y no más de 20', (await filas(p)) === Math.min(20, N_POR_FABRICAR) && (await p.evaluate(() => [...document.querySelectorAll('tbody tr')].every((tr) => /Por fabricar/.test(tr.innerText)))))
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('se puede paginar dentro de lo filtrado', (await rango(p)) === `Mostrando 21–${Math.min(40, N_POR_FABRICAR)} de ${N_POR_FABRICAR} órdenes`)
  // Cambiar otro filtro (adicionales) desde la página 2
  await p.evaluate(() => [...document.querySelectorAll('label')].find((l) => /Mostrar adicionales/.test(l.innerText))?.querySelector('input')?.click()); await dormir(800)
  chequeo('al marcar "Mostrar adicionales" también vuelve a la página 1 (y el total cambia)', /^Página 1 de/.test((await paginaTxt(p)) ?? '') && (await total(p)) >= N_POR_FABRICAR, `${await paginaTxt(p)} ${await rango(p)}`)
  await clicTexto(p, 'button', 'Siguiente')
  await p.evaluate(() => [...document.querySelectorAll('label')].find((l) => /Mostrar adicionales/.test(l.innerText))?.querySelector('input')?.click()); await dormir(800)
  chequeo('al desmarcar "Mostrar adicionales" vuelve a la página 1 y al total de antes', /^Página 1 de/.test((await paginaTxt(p)) ?? '') && (await total(p)) === N_POR_FABRICAR, `${await paginaTxt(p)} ${await rango(p)}`)
  await clicTexto(p, 'button', 'Siguiente')
  await clicTexto(p, 'button', 'Limpiar filtros')
  chequeo('"Limpiar filtros" vuelve a la página 1 y al total sin filtrar', /^Página 1 de/.test((await paginaTxt(p)) ?? '') && (await total(p)) === N, `${await paginaTxt(p)} ${await rango(p)}`)
  // Tamaño elegido se conserva al filtrar
  await porPaginaSelect(p, 50)
  await clicTexto(p, 'button', 'Siguiente')
  await selectEstado(p, 'por_fabricar')
  chequeo('el tamaño de página elegido (50) se conserva al filtrar, y vuelve a la página 1', (await rango(p)) === `Mostrando 1–${Math.min(50, N_POR_FABRICAR)} de ${N_POR_FABRICAR} órdenes` && (await p.evaluate(() => document.querySelector('[aria-label="Por página"]').value)) === '50')
  // Tocar una tarjeta de resumen (filtra por estado) desde otra página
  await selectEstado(p, 'todos')
  await porPaginaSelect(p, 20)
  await clicTexto(p, 'button', 'Siguiente')
  await p.evaluate(() => [...document.querySelectorAll('[role=button][aria-pressed]')].find((c) => /Fabricado/.test(c.getAttribute('aria-label') ?? ''))?.click()); await dormir(800)
  chequeo('tocar una tarjeta de resumen (filtra por estado) también vuelve a la página 1', /^Página 1 de/.test((await paginaTxt(p)) ?? ''), String(await paginaTxt(p)))
  // Filtro sin resultados
  await selectEstado(p, 'todos')
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 3. Cambios pendientes entre páginas ================= */
await seccion('3. Los cambios pendientes del 4b no se pierden al cambiar de página')
{
  const p = await abrir('administrador', '/pedidos')
  const casillaDe = (etapa) => p.evaluateHandle((e) => [...document.querySelectorAll('input[type=checkbox]')].find((i) => new RegExp(`^${e} del pedido `).test(i.getAttribute('aria-label') ?? '')) ?? null, etapa)
  const b1 = await casillaDe('B')
  const etiqueta1 = await b1.asElement().evaluate((i) => i.getAttribute('aria-label'))
  await b1.asElement().click(); await dormir(300)
  chequeo('se marca una casilla en la página 1', (await contador(p)) === '1 cambio sin guardar en 1 mueble', await contador(p))
  await clicTexto(p, 'button', 'Siguiente')
  const i2 = await casillaDe('I')
  await i2.asElement().click(); await dormir(300)
  chequeo('y otra en la página 2: la barra cuenta las de las dos páginas', /^2 cambios sin guardar en 2 muebles$/.test((await contador(p)) ?? ''), await contador(p))
  chequeo('el título de la pestaña lleva el contador (2)', (await p.evaluate(() => document.title)).startsWith('(2) '))
  await clicTexto(p, 'button', 'Anterior')
  const sigue = await p.evaluate((l) => { const i = document.querySelector(`input[aria-label^="${l}"]`); return { marcada: i?.checked, pendiente: i?.closest('label')?.getAttribute('data-pendiente') === 'si' } }, etiqueta1)
  chequeo('al volver a la página 1 la casilla sigue marcada y destacada como pendiente', sigue.marcada === true && sigue.pendiente === true, JSON.stringify(sigue))
  chequeo('la barra sigue con los 2 cambios', /^2 cambios/.test((await contador(p)) ?? ''))
  await porPaginaSelect(p, 50)
  chequeo('cambiar el tamaño de página tampoco los pierde', /^2 cambios/.test((await contador(p)) ?? ''))
  await selectEstado(p, 'por_fabricar')
  chequeo('ni cambiar un filtro', /^2 cambios/.test((await contador(p)) ?? ''))
  await clicTexto(p, 'button', 'Revisar y guardar')
  await clicTexto(p, '[role=dialog] button', 'Guardar 2 cambios'); await dormir(1000)
  chequeo('se guardan los 2 cambios (de las dos páginas) en una sola operación', (await contador(p)) === null && (await p.evaluate(() => window.__srv.llamadas.length)) === 1 && (await p.evaluate(() => window.__srv.llamadas[0].length)) === 2)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 4. La tabla de /hojas/nueva ================= */
await seccion('4. /hojas/nueva usa el mismo paginador: lo elegido se conserva y "elegir todos" vale por página')
{
  const p = await abrir('administrador', '/hojas/nueva')
  const n = await total(p)
  chequeo(`parte filtrada en "Por fabricar" y paginada: "Mostrando 1–${Math.min(20, N_POR_FABRICAR)} de ${N_POR_FABRICAR}"`, n === N_POR_FABRICAR && (await filas(p)) === Math.min(20, N_POR_FABRICAR), `${await rango(p)} ${await filas(p)}`)
  await (await p.evaluateHandle(() => document.querySelector('[aria-label="Elegir todos los pedidos de esta página para la hoja de fabricación"]'))).asElement().click(); await dormir(500)
  const elegidos1 = await p.evaluate(() => document.querySelectorAll('ul[aria-label="Pedidos de la hoja"] li').length)
  const pedidosPagina1 = await p.evaluate(() => new Set([...document.querySelectorAll('tbody input[aria-label^="Elegir el pedido "]')].map((i) => i.getAttribute('aria-label'))).size)
  chequeo('"Elegir todos de esta página" elige los pedidos de la página (no los de las otras)', elegidos1 === pedidosPagina1 && elegidos1 > 0 && elegidos1 <= 20, `${elegidos1} vs ${pedidosPagina1}`)
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('al cambiar de página lo elegido se conserva (el panel sigue igual)', (await p.evaluate(() => document.querySelectorAll('ul[aria-label="Pedidos de la hoja"] li').length)) === elegidos1)
  await (await p.evaluateHandle(() => [...document.querySelectorAll('tbody input[aria-label^="Elegir el pedido "]')].find((i) => !i.checked))).asElement().click(); await dormir(300)
  chequeo('y se puede sumar uno de la página 2: el panel cuenta uno más', (await p.evaluate(() => document.querySelectorAll('ul[aria-label="Pedidos de la hoja"] li').length)) === elegidos1 + 1)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 5. Celular ================= */
await seccion('5. Pedidos en el celular')
{
  const p = await abrir('bodega', '/pedidos', { ancho: 390, alto: 844 })
  chequeo('sin desborde horizontal de la página', !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)))
  chequeo(`la lista muestra 20 tarjetas y "Mostrando 1–20 de ${N} órdenes"`, (await tarjetas(p)) === 20 && (await rango(p)) === `Mostrando 1–20 de ${N} órdenes`, `${await tarjetas(p)} ${await rango(p)}`)
  await p.evaluate(() => document.querySelector('[data-paginador]').scrollIntoView({ block: 'center' })); await dormir(200)
  await captura(p, '5-pedidos-movil')
  chequeo('el paginador cabe en la pantalla', await p.evaluate(() => document.querySelector('[data-paginador]').scrollWidth <= window.innerWidth + 2))
  await clicTexto(p, 'button', 'Siguiente')
  chequeo('"Siguiente" funciona con el dedo: "Mostrando 21–40"', (await rango(p)) === `Mostrando 21–40 de ${N} órdenes` && (await tarjetas(p)) === 20)
  await clicTexto(p, 'button', 'Filtros')
  await selectEstado(p, 'por_fabricar')
  chequeo('en el celular también, al filtrar vuelve a la página 1', (await rango(p)) === `Mostrando 1–${Math.min(20, N_POR_FABRICAR)} de ${N_POR_FABRICAR} órdenes`, String(await rango(p)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

try { await navegador?.close() } catch { /* ya cerrado */ }
console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
