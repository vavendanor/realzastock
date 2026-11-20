/* /despachos en Chrome real contra el banco de pruebas (ver pruebas/README.md): grupos por comuna, sin dirección y
   retiros, programar (también despachos parciales), ver por fecha, quitar, marcar despachado, comprobante, cambios
   pendientes del 4b y permisos por rol. Los muebles de la prueba se arman con pedidos de octubre. */
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://localhost:5180'
const CAPTURAS = process.argv[2] ?? join(tmpdir(), 'capturas-despachos')
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

/* ---- Los muebles de la prueba, elegidos del propio set de octubre ---- */
const fabricable = (o) => !o.es_adicional || o.tipo === 'COJÍN'
const porPedido = new Map()
for (const o of datos) porPedido.set(o.pedido_numero, [...(porPedido.get(o.pedido_numero) ?? []), o])
const piezas = (ped) => porPedido.get(ped).filter((o) => fabricable(o) && !o.cancelado_en)
const numericos = [...porPedido.keys()].filter((p) => /^\d+$/.test(p))
const SIMPLES = numericos.filter((p) => piezas(p).length === 1 && piezas(p)[0].estado === 'por_fabricar')
const P_DOBLE = numericos.find((p) => piezas(p).length === 2 && piezas(p).every((o) => o.estado === 'por_fabricar'))
const [S1, S2, S3, S4, S5, S6, S7, S8, S9] = SIMPLES.filter((p) => p !== P_DOBLE)
const num = (ped) => piezas(ped)[0].numero
const [D1, D2] = piezas(P_DOBLE).map((o) => o.numero).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))

const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const sumar = (f, d) => new Date(Date.parse(`${f}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
const HOY = hoyChile(), MANANA = sumar(HOY, 1), AYER = sumar(HOY, -1), PASADO = sumar(HOY, 2)
const corto = (f) => f.split('-').reverse().join('-')
const etiqueta = (f) => { const [a, m, d] = f.split('-').map(Number); const n = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay()]; return `${n[0].toUpperCase()}${n.slice(1)} ${corto(f)}` }

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
    window.print = () => { window.__impreso = (window.__impreso ?? 0) + 1 } // el diálogo de impresión no se abre en las pruebas
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
  await dormir(500)
  return true
}
const hay = (p, selector, t, exacto = false) => p.evaluate((sel, t, exacto) => [...document.querySelectorAll(sel)].some((e) => { const x = (e.textContent ?? '').trim(); return exacto ? x === t : x.startsWith(t) }), selector, t, exacto)
const deshabilitado = (p, t) => p.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim().startsWith(t)); return b ? b.disabled : null }, t)
const porEtiqueta = async (p, etiquetaAria) => (await p.evaluateHandle((l) => document.querySelector(`[aria-label="${l}"]`), etiquetaAria)).asElement()
async function elegir(p, numero) { const e = await porEtiqueta(p, `Elegir ${numero} para despachar`); if (!e) throw new Error('no está ' + numero); await e.click(); await dormir(200) }
async function fijarFecha(p, etiquetaCampo, valor) {
  await p.evaluate((t, v) => {
    const i = [...document.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === t)?.querySelector('input')
    if (!i) throw new Error('no hay campo ' + t)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v)
    i.dispatchEvent(new Event('input', { bubbles: true }))
  }, etiquetaCampo, valor)
  await dormir(200)
}
const titulosGrupos = (p) => p.evaluate(() => [...document.querySelectorAll('main section[aria-label]')].map((s) => s.getAttribute('aria-label')))
const mueblesDe = (p, titulo) => p.evaluate((t) => [...(document.querySelector(`main section[aria-label="${t}"]`)?.querySelectorAll('[data-mueble]') ?? [])].map((e) => e.getAttribute('data-mueble')), titulo)
const todosLosMuebles = (p) => p.evaluate(() => [...document.querySelectorAll('main [data-mueble]')].map((e) => e.getAttribute('data-mueble')))
const barra = (p) => p.evaluate(() => document.querySelector('[data-barra-despacho]')?.innerText.replace(/\s+/g, ' ') ?? null)
const aviso = (p) => p.evaluate(() => { const a = document.querySelector('[data-aviso-despacho]'); return a ? { tipo: a.getAttribute('data-aviso-despacho'), texto: a.innerText.trim() } : null })
const fila = (p, n) => srv(p, (n) => { const f = window.__srv.fila(n); return f ? { estado: f.estado, fecha: f.despacho_programado ?? null, despachado: f.despachado_en ?? null } : null }, n)
const cmp = (a, b) => Number(a) - Number(b)

/* Deja el banco con los muebles de la prueba (y nada más esperando entrega). */
const cfgNumero = num(S1)
async function preparar(p) {
  await srv(p, (cfg) => {
    const s = window.__srv
    for (const e of ['fabricado', 'en_despacho']) for (const n of s.numeros(e)) s.otro(n, { estado: 'entregado' })
    const fab = (n, campos) => s.otro(n, { estado: 'fabricado', listo: true, ...campos })
    fab(cfg.f1, { comuna: 'Providencia' })
    fab(cfg.f2, { comuna: 'Providencia' })
    fab(cfg.f3, { comuna: 'Ñuñoa' })
    fab(cfg.f4, { comuna: 'Las Condes' })
    fab(cfg.f5, { comuna: 'RETIRO TIENDA' })
    fab(cfg.f6, { comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO' })
    fab(cfg.f7, { comuna: 'Maipú', cancelado_en: new Date().toISOString() })
    fab(cfg.f8, { comuna: 'Maipú', despacho_programado: cfg.manana })
    s.otro(cfg.f9, { estado: 'en_despacho', listo: true, comuna: 'Vitacura', despacho_programado: cfg.hoy, despachado_en: new Date().toISOString() })
    fab(cfg.d1, { comuna: 'Providencia' }) // el otro mueble de ese pedido sigue por fabricar
  }, { f1: num(S1), f2: num(S2), f3: num(S3), f4: num(S4), f5: num(S5), f6: num(S6), f7: num(S7), f8: num(S8), f9: num(S9), d1: D1, hoy: HOY, manana: MANANA })
  await clicTexto(p, 'button', 'Recargar')
  await p.waitForFunction((n) => !!document.querySelector(`[data-mueble="${n}"]`), { timeout: 10_000 }, cfgNumero)
  await dormir(300)
}

console.log(`Muebles de prueba: ${[S1, S2, S3, S4, S5, S6, S7, S8, S9].map(num).join(', ')}; pedido doble ${P_DOBLE} (${D1}, ${D2})`)

/* ================= 1. Lista por despachar ================= */
await seccion('1. Por despachar: grupos por comuna, sin dirección y retiros en tienda')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  const titulos = await titulosGrupos(p)
  chequeo('rutas por comuna en orden alfabético, luego "Sin dirección" y al final "Retiro en tienda"', JSON.stringify(titulos) === JSON.stringify(['Las Condes', 'Maipú', 'Ñuñoa', 'Providencia', 'Sin dirección', 'Retiro en tienda']), titulos.join('|'))
  const ordenPed = (...ns) => ns.sort((a, b) => cmp(a.replace(/-.*/, ''), b.replace(/-.*/, '')) || a.localeCompare(b, 'es', { numeric: true }))
  chequeo('Providencia: sus 3 muebles (los 2 pedidos y el fabricado del pedido doble), ordenados por pedido', JSON.stringify(await mueblesDe(p, 'Providencia')) === JSON.stringify(ordenPed(num(S1), num(S2), D1)), (await mueblesDe(p, 'Providencia')).join())
  chequeo('Ñuñoa, Las Condes y Maipú: un mueble cada una', (await mueblesDe(p, 'Ñuñoa')).join() === num(S3) && (await mueblesDe(p, 'Las Condes')).join() === num(S4) && (await mueblesDe(p, 'Maipú')).join() === num(S8))
  chequeo('"Sin dirección" tiene el mueble sin dirección, aparte de las rutas', (await mueblesDe(p, 'Sin dirección')).join() === num(S6))
  chequeo('"Retiro en tienda" tiene el retiro, fuera de las rutas', (await mueblesDe(p, 'Retiro en tienda')).join() === num(S5) && /fuera de las rutas/.test(await p.evaluate(() => document.querySelector('main section[aria-label="Retiro en tienda"]').innerText)))
  const todos = await todosLosMuebles(p)
  chequeo('NO aparecen: el pedido cancelado, el que ya salió, el mueble que sigue por fabricar ni los entregados', ![num(S7), num(S9), D2].some((n) => todos.includes(n)) && todos.length === 8, todos.join())
  const tab = await p.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((b) => b.textContent.trim()))
  chequeo('las pestañas cuentan: "Por despachar (8)" y "Programados por fecha (1)"', tab.join('|') === 'Por despachar (8)|Programados por fecha (1)', tab.join('|'))
  const filaD1 = await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`)?.innerText.replace(/\s+/g, ' ') ?? '', D1)
  chequeo('el mueble del pedido doble avisa "Pedido en partes: 1 por fabricar"', /Pedido en partes: 1 por fabricar/.test(filaD1), filaD1)
  const filaS8 = await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`)?.innerText.replace(/\s+/g, ' ') ?? '', num(S8))
  chequeo('el que ya tiene fecha lo muestra: "Programado dd-mm-aaaa"', filaS8.includes(`Programado ${corto(MANANA)}`), filaS8)
  chequeo('al comienzo no hay barra de acciones', (await barra(p)) === null)
  await captura(p, '1-por-despachar')
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 2. Programar un despacho (también parcial) ================= */
await seccion('2. Programar un despacho: fecha, muebles y despacho parcial')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  await elegir(p, num(S1)); await elegir(p, D1)
  chequeo('al elegir muebles aparece la barra con el conteo', /2 muebles elegidos/.test((await barra(p)) ?? ''), String(await barra(p)))
  const lim = await p.evaluate(() => { const i = [...document.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === 'Fecha del despacho')?.querySelector('input'); return { valor: i?.value, min: i?.min } })
  chequeo('la fecha propone mañana y no deja elegir antes de hoy (mínimo = hoy)', lim.valor === MANANA && lim.min === HOY, JSON.stringify(lim))
  await fijarFecha(p, 'Fecha del despacho', AYER)
  chequeo('una fecha de ayer se rechaza: aviso y botón deshabilitado', (await deshabilitado(p, 'Programar despacho')) === true && /anterior a hoy/.test(await texto(p)))
  await fijarFecha(p, 'Fecha del despacho', '')
  chequeo('sin fecha tampoco se puede programar', (await deshabilitado(p, 'Programar despacho')) === true)
  await fijarFecha(p, 'Fecha del despacho', PASADO)
  await clicTexto(p, 'button', 'Programar despacho'); await dormir(800)
  const a = await aviso(p)
  chequeo(`el aviso confirma: "Se programaron 2 muebles para el ${etiqueta(PASADO)}"`, a?.tipo === 'ok' && a.texto.includes(`Se programaron 2 muebles para el ${etiqueta(PASADO)}`), JSON.stringify(a))
  chequeo('el servidor guardó la fecha en los 2 muebles; los demás quedaron igual', (await fila(p, num(S1))).fecha === PASADO && (await fila(p, D1)).fecha === PASADO && (await fila(p, num(S2))).fecha === null)
  chequeo('despacho PARCIAL: el pedido doble sale con 1 mueble y el otro sigue por fabricar', (await fila(p, D1)).estado === 'fabricado' && (await srv(p, (n) => window.__srv.fila(n).estado, D2)) === 'por_fabricar')
  chequeo('la selección se limpia y la barra desaparece', (await barra(p)) === null)
  const filaS1 = await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`)?.innerText.replace(/\s+/g, ' ') ?? '', num(S1))
  chequeo('los muebles programados muestran su fecha en la lista', filaS1.includes(`Programado ${corto(PASADO)}`), filaS1)
  // Elegir todos de una comuna, y limpiar
  await (await porEtiqueta(p, 'Elegir todos los muebles de Providencia')).click(); await dormir(300)
  chequeo('"Elegir todos" de una comuna elige sus 3 muebles', /3 muebles elegidos/.test((await barra(p)) ?? ''))
  await clicTexto(p, 'button', 'Limpiar selección')
  chequeo('"Limpiar selección" quita la barra', (await barra(p)) === null)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 3. Ver por fecha y quitar ================= */
await seccion('3. Programados por fecha: ver y quitar un mueble antes de que salga')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  await elegir(p, num(S1)); await elegir(p, D1)
  await fijarFecha(p, 'Fecha del despacho', PASADO)
  await clicTexto(p, 'button', 'Programar despacho'); await dormir(800)
  await srv(p, (n, f) => window.__srv.otro(n, { despacho_programado: f }), num(S3), AYER) // programado ayer y sin salir
  await clicTexto(p, 'button', 'Programados por fecha'); await dormir(300)
  await clicTexto(p, 'button', 'Recargar'); await dormir(700)
  const titulos = await titulosGrupos(p)
  const t = (f, pref = '') => `${pref}${etiqueta(f)}`
  chequeo('un grupo por día, el más próximo primero: ayer, hoy, mañana, pasado mañana', JSON.stringify(titulos) === JSON.stringify([t(AYER), t(HOY, 'Hoy · '), t(MANANA, 'Mañana · '), t(PASADO)]), titulos.join('|'))
  chequeo('lo programado para ayer y sin salir se marca "Atrasado"', await p.evaluate((x) => /Atrasado/.test(document.querySelector(`main section[aria-label="${x}"]`).innerText), t(AYER)))
  const hoy = await p.evaluate((x) => { const s = document.querySelector(`main section[aria-label="${x}"]`); return { texto: s.innerText.replace(/\s+/g, ' '), salidos: [...s.querySelectorAll('[data-salido]')].map((e) => e.getAttribute('data-mueble')), habilitados: [...s.querySelectorAll('input[type=checkbox]:not(:disabled)')].length } }, t(HOY, 'Hoy · '))
  chequeo('"Hoy": 0 por salir y 1 que ya salió, en gris y sin casilla', /0 muebles por salir · 1 ya salió/.test(hoy.texto) && hoy.salidos.join() === num(S9) && hoy.habilitados === 0, JSON.stringify(hoy))
  chequeo('lo que ya salió trae su botón de comprobante', await hay(p, 'button', `Comprobante ${S9}`))
  chequeo('"Mañana" tiene el mueble programado desde el inicio y "pasado mañana" los 2 nuevos', (await mueblesDe(p, t(MANANA, 'Mañana · '))).join() === num(S8) && (await mueblesDe(p, t(PASADO))).sort().join() === [num(S1), D1].sort().join())
  const filaS8 = await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`)?.innerText.replace(/\s+/g, ' ') ?? '', num(S8))
  chequeo('en esta vista cada fila dice su destino (comuna)', /Maipú/.test(filaS8), filaS8)
  await captura(p, '3-por-fecha')
  await elegir(p, num(S1))
  chequeo('al elegir un mueble programado aparece "Quitar de la fecha (1)"', /Quitar de la fecha \(1\)/.test(await texto(p)))
  await clicTexto(p, 'button', 'Quitar de la fecha'); await dormir(800)
  const a = await aviso(p)
  chequeo('"Quitar de la fecha": el aviso confirma y el servidor deja el mueble sin fecha', a?.tipo === 'ok' && /Se quitó la fecha de 1 mueble/.test(a.texto) && (await fila(p, num(S1))).fecha === null, JSON.stringify(a))
  chequeo('el mueble sale de la fecha (queda D1 solo) y no se tocó el otro', (await mueblesDe(p, t(PASADO))).join() === D1 && (await fila(p, D1)).fecha === PASADO)
  await clicTexto(p, 'button', 'Por despachar')
  const filaS1 = await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`)?.innerText.replace(/\s+/g, ' ') ?? '', num(S1))
  chequeo('vuelve a "Por despachar" sin etiqueta de fecha', filaS1.length > 0 && !/Programado/.test(filaS1), filaS1)
  // quitar la fecha a uno programado para mañana y despachado por otra persona a la vez
  await clicTexto(p, 'button', 'Programados por fecha')
  await elegir(p, num(S8))
  await srv(p, (n) => window.__srv.otro(n, { estado: 'en_despacho' }), num(S8))
  await clicTexto(p, 'button', 'Quitar de la fecha'); await dormir(800)
  chequeo('si otra persona ya lo despachó, se rechaza y se explica cuál', (await aviso(p))?.tipo === 'error' && new RegExp(`Ya salieron a despacho.*${num(S8)}`).test((await aviso(p)).texto), JSON.stringify(await aviso(p)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 4. Marcar despachado y comprobante ================= */
await seccion('4. Marcar como despachado, y el comprobante de despacho')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  await elegir(p, num(S2)); await elegir(p, num(S4))
  await clicTexto(p, 'button', 'Marcar como despachado')
  const dlg = await p.evaluate(() => document.querySelector('[role=dialog]')?.innerText.replace(/\s+/g, ' ') ?? '')
  chequeo('pide confirmación con el conteo y los pedidos', /¿Marcar 2 muebles como despachados\?/.test(dlg) && dlg.includes(S2) && dlg.includes(S4), dlg)
  chequeo('el foco inicial está en "Volver" (no en confirmar)', await p.evaluate(() => document.activeElement?.textContent.trim() === 'Volver'))
  await p.keyboard.press('Escape'); await dormir(300)
  chequeo('Escape cierra el aviso sin cambiar nada', !(await p.evaluate(() => document.querySelector('[role=dialog]'))) && (await fila(p, num(S2))).estado === 'fabricado' && /2 muebles elegidos/.test((await barra(p)) ?? ''))
  await clicTexto(p, 'button', 'Marcar como despachado')
  await clicTexto(p, '[role=dialog] button', 'Marcar 2 despachados'); await dormir(900)
  const a = await aviso(p)
  chequeo('el aviso confirma: 2 muebles ahora "En despacho"', a?.tipo === 'ok' && /Se marcaron como despachados 2 muebles/.test(a.texto), JSON.stringify(a))
  const f2 = await fila(p, num(S2)), f4 = await fila(p, num(S4))
  chequeo('el servidor los pasa a en despacho, guarda cuándo salieron y les pone la fecha de hoy', f2.estado === 'en_despacho' && f4.estado === 'en_despacho' && f2.despachado !== null && f4.despachado !== null && f2.fecha === HOY && f4.fecha === HOY, JSON.stringify([f2, f4]))
  chequeo('salen de "Por despachar"', !(await todosLosMuebles(p)).some((n) => [num(S2), num(S4)].includes(n)))
  chequeo('el aviso ofrece el comprobante de cada pedido', (await hay(p, 'button', `Comprobante ${S2}`)) && (await hay(p, 'button', `Comprobante ${S4}`)))
  await clicTexto(p, 'button', `Comprobante ${S2}`); await dormir(900)
  const cp = await p.evaluate(() => ({ impreso: window.__impreso ?? 0, texto: document.querySelector('.comprobante-impresion')?.textContent ?? '' }))
  chequeo('el comprobante se abre para imprimir: "Comprobante de despacho", "Pedido N.º X" y el mueble', cp.impreso === 1 && /Comprobante de despacho/.test(cp.texto) && cp.texto.includes(`Pedido N.º ${S2}`) && cp.texto.includes(num(S2)), cp.texto.slice(0, 200))
  chequeo('el comprobante NO lista muebles que no salieron', !cp.texto.includes(num(S1)) && !cp.texto.includes(num(S3)))
  await clicTexto(p, 'button', 'Programados por fecha'); await dormir(300)
  const g = await titulosGrupos(p)
  const salidosHoy = await p.evaluate((x) => [...document.querySelector(`main section[aria-label="${x}"]`).querySelectorAll('[data-salido]')].map((e) => e.getAttribute('data-mueble')).sort(), `Hoy · ${etiqueta(HOY)}`)
  chequeo('en la vista por fecha, la fecha de hoy suma los 2 despachados al que ya había salido (3, en gris)', g.includes(`Hoy · ${etiqueta(HOY)}`) && JSON.stringify(salidosHoy) === JSON.stringify([num(S2), num(S4), num(S9)].sort()), salidosHoy.join())
  // Un mueble que cambió de estado mientras tanto: se rechaza todo y no se despacha ninguno
  await clicTexto(p, 'button', 'Por despachar')
  await elegir(p, num(S3)); await elegir(p, num(S6))
  await srv(p, (n) => window.__srv.otro(n, { estado: 'en_despacho' }), num(S6))
  await clicTexto(p, 'button', 'Marcar como despachado')
  await clicTexto(p, '[role=dialog] button', 'Marcar 2 despachados'); await dormir(900)
  const e = await aviso(p)
  chequeo('si otra persona ya despachó uno, se rechaza TODO y el mensaje nombra al mueble', e?.tipo === 'error' && e.texto.includes(num(S6)) && /No se despachó ninguno/.test(e.texto) && (await fila(p, num(S3))).estado === 'fabricado', JSON.stringify(e))
  chequeo('"Pasar a en despacho" del detalle de un pedido sigue funcionando', await (async () => {
    const id = await srv(p, (n) => window.__srv.fila(n).id, num(S5))
    await p.goto(`${BASE}/pedidos/${id}`, { waitUntil: 'networkidle0' }); await dormir(600)
    const hubo = await clicTexto(p, 'button', 'Pasar a en despacho'); await dormir(800)
    return hubo && (await fila(p, num(S5))).estado === 'en_despacho'
  })())
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 5. Cambios pendientes del 4b ================= */
await seccion('5. Los cambios pendientes del 4b siguen intactos')
{
  const p = await abrir('administrador', '/despachos')
  await preparar(p)
  await p.goto(`${BASE}/pedidos`, { waitUntil: 'networkidle0' }); await dormir(800)
  const c = await p.evaluateHandle((n) => [...document.querySelectorAll('input[type=checkbox]')].find((i) => (i.getAttribute('aria-label') ?? '') === `B del pedido ${n}`) ?? null, num(S3))
  await c.asElement().click(); await dormir(300)
  const contador = () => p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)
  chequeo('marcar una casilla en Pedidos deja el cambio pendiente', (await contador()) === '1 cambio sin guardar en 1 mueble', await contador())
  await p.evaluate(() => { const g = [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Pedidos'); if (!document.querySelector('#submenu-pedidos')) g?.click() }); await dormir(300)
  await p.evaluate(() => [...document.querySelectorAll('#submenu-pedidos a')].find((a) => a.textContent.trim() === 'Despachos')?.click())
  await p.waitForSelector('[data-mueble]', { timeout: 10_000 }); await dormir(300)
  chequeo('ir a Despachos desde el menú NO pide confirmación y conserva la barra de cambios', ruta(p) === '/despachos' && !(await p.evaluate(() => document.querySelector('[role=dialog]'))) && (await contador()) === '1 cambio sin guardar en 1 mueble', `${ruta(p)} ${await contador()}`)
  const casilla = await porEtiqueta(p, `Elegir ${num(S3)} para despachar`)
  chequeo('el mueble con cambios sin guardar no se puede elegir (cambiaría su estado) y lo dice', await casilla.evaluate((i) => i.disabled) && /Cambios sin guardar/.test(await p.evaluate((n) => document.querySelector(`[data-mueble="${n}"]`).innerText, num(S3))))
  chequeo('los demás muebles siguen disponibles', !(await (await porEtiqueta(p, `Elegir ${num(S4)} para despachar`)).evaluate((i) => i.disabled)))
  await clicTexto(p, 'button', 'Revisar y guardar')
  await clicTexto(p, '[role=dialog] button', 'Guardar 1 cambio'); await dormir(1000)
  chequeo('al guardar desde la barra, el servidor recibe el cambio, la barra se va y el mueble vuelve a ser elegible', (await srv(p, (n) => window.__srv.fila(n).etapa_b, num(S3))) === true && (await contador()) === null && !(await (await porEtiqueta(p, `Elegir ${num(S3)} para despachar`)).evaluate((i) => i.disabled)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 6. Permisos ================= */
await seccion('6. Permisos por rol')
{
  for (const rol of ['vendedor', null]) {
    const p = await abrir(rol, '/despachos')
    chequeo(`${rol ?? 'anónimo'} NO entra a /despachos (termina en ${ruta(p)})`, ruta(p) !== '/despachos' && (rol !== null || ruta(p) === '/login') && !/Programar despacho|Por despachar/.test(await texto(p)))
    await cerrar(p)
  }
  const b = await abrir('bodega', '/despachos')
  chequeo('bodega SÍ entra a /despachos', ruta(b) === '/despachos' && /Por despachar/.test(await texto(b)))
  await preparar(b)
  await elegir(b, num(S1))
  await fijarFecha(b, 'Fecha del despacho', PASADO)
  await clicTexto(b, 'button', 'Programar despacho'); await dormir(800)
  chequeo('bodega puede programar', (await fila(b, num(S1))).fecha === PASADO)
  await elegir(b, num(S2))
  await clicTexto(b, 'button', 'Marcar como despachado'); await clicTexto(b, '[role=dialog] button', 'Marcar 1 despachados'); await dormir(800)
  chequeo('bodega puede marcar despachado', (await fila(b, num(S2))).estado === 'en_despacho')
  chequeo('sin errores en la consola', b.errores.length === 0, b.errores.join(' | '))
  await cerrar(b)
  const a = await abrir('administrador', '/despachos')
  chequeo('administrador SÍ entra a /despachos', ruta(a) === '/despachos' && /Por despachar/.test(await texto(a)))
  await cerrar(a)
}

/* ================= 7. Celular ================= */
await seccion('7. Despachos en el celular')
{
  const p = await abrir('bodega', '/despachos', { ancho: 390, alto: 844 })
  await preparar(p)
  chequeo('sin desborde horizontal de la página', !(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)))
  await elegir(p, num(S1)); await elegir(p, num(S2))
  chequeo('la barra de acciones aparece también en el celular', /2 muebles elegidos/.test((await barra(p)) ?? ''))
  chequeo('...y está a la vista (pegada abajo), aunque la lista sea larga', await p.evaluate(() => { const r = document.querySelector('[data-barra-despacho]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1 }))
  await captura(p, '7-despachos-movil')
  await fijarFecha(p, 'Fecha del despacho', PASADO)
  await clicTexto(p, 'button', 'Programar despacho'); await dormir(800)
  chequeo('se puede programar desde el celular', (await fila(p, num(S1))).fecha === PASADO)
  await clicTexto(p, 'button', 'Programados por fecha'); await dormir(300)
  chequeo('la vista por fecha también se ve', (await titulosGrupos(p)).some((t) => t.includes(etiqueta(PASADO))))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

try { await navegador?.close() } catch { /* ya cerrado */ }
console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
