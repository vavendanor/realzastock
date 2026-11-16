import puppeteer from 'puppeteer-core'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5180'
const CAPTURAS = process.argv[2] ?? join(tmpdir(), 'capturas-cambios')
mkdirSync(CAPTURAS, { recursive: true })
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
  navegador = await lanzar() // un navegador limpio (sin datos guardados) por escenario
}
const cerrar = async (...ps) => { for (const p of ps) { try { await p.close() } catch { /* nada */ } } }

/* Una pestaña con la sesión ya iniciada, vigilando errores y diálogos del navegador. */
async function abrir(rol, ruta, { ancho = 1366, alto = 900 } = {}) {
  const p = await navegador.newPage()
  await p.setViewport({ width: ancho, height: alto })
  p.errores = []
  p.dialogos = []
  p.on('pageerror', (e) => p.errores.push(String(e.message).slice(0, 200)))
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|manifest|style property during rerender/i.test(m.text())) p.errores.push(m.text().slice(0, 200)) })
  p.on('dialog', async (d) => { p.dialogos.push(d.type()); try { await d.accept() } catch { /* ya cerrado */ } })
  await p.evaluateOnNewDocument((r) => {
    if (!sessionStorage.getItem('__limpio')) {
      localStorage.removeItem('test-srv')
      localStorage.removeItem('test-rol')
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
const titulo = (p) => p.evaluate(() => document.title)
const srv = (p, fn, ...args) => p.evaluate(fn, ...args)

/* Clic real (con actividad del usuario) sobre una casilla identificada por su etiqueta. */
async function casilla(p, numero, etapa, { clic = true } = {}) {
  const e = etapa === 'listo' ? 'LISTO' : etapa.toUpperCase()
  const h = await p.evaluateHandle((n, et) => {
    const base = `${et} del pedido ${n}`
    return [...document.querySelectorAll('input[type=checkbox]')].find((i) => {
      const l = i.getAttribute('aria-label') || ''
      return l === base || l.startsWith(base + ' (')
    }) ?? null
  }, numero, e)
  const el = h.asElement()
  if (!el) return null
  const estado = await el.evaluate((i) => ({ marcada: i.checked, pendiente: i.closest('label')?.getAttribute('data-pendiente') === 'si', problema: i.closest('label')?.getAttribute('data-problema') === 'si' }))
  if (clic) { await el.click(); await dormir(250) }
  return estado
}
const estadoCasilla = (p, numero, etapa) => casilla(p, numero, etapa, { clic: false })
async function boton(p, etiqueta) {
  const h = await p.evaluateHandle((t) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(t) && !b.disabled) ?? null, etiqueta)
  const el = h.asElement()
  if (!el) return false
  await el.click()
  await dormir(450)
  return true
}
const contador = (p) => p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)
const dialogo = (p) => p.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? null)
const aviso = (p) => p.evaluate(() => { const a = document.querySelector('[data-aviso]'); return a ? { tipo: a.getAttribute('data-aviso'), texto: a.innerText.trim() } : null })
const problemas = (p) => p.evaluate(() => [...document.querySelectorAll('[data-problemas] li')].map((l) => l.textContent.trim()))
const pendientesVisibles = (p) => p.evaluate(() => document.querySelectorAll('label[data-pendiente="si"]').length)
const almacenado = (p) => p.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('rh:pendientes:v1:')))
const captura = (p, nombre) => p.screenshot({ path: `${CAPTURAS}/${nombre}.png` })
/* "Pedidos" ahora es un desplegable: se abre (si hace falta) y se elige su opción "Pedidos". */
async function irAPedidos(p) {
  const hayEnlace = () => p.evaluate(() => [...document.querySelectorAll('nav a')].some((e) => e.textContent?.trim() === 'Pedidos'))
  if (!(await hayEnlace())) { await p.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => b.textContent?.trim() === 'Pedidos')?.click()); await dormir(300) }
  await p.evaluate(() => [...document.querySelectorAll('nav a')].find((e) => e.textContent?.trim() === 'Pedidos')?.click())
  await dormir(900)
}
const A = '1295-1', B = '1295-2', C = '1294-1', D = '1294-2'

/* ================= 1. Marcar y anular ================= */
await seccion('1. Marcar casillas: barra, contador y título')
{
  const p = await abrir('administrador', '/pedidos')
  const t0 = await titulo(p)
  chequeo('al comienzo no hay barra ni contador en el título', (await contador(p)) === null && !/^\(\d+\)/.test(t0), t0)
  for (const [n, e] of [[A, 'b'], [A, 'i'], [B, 'b'], [B, 'c']]) await casilla(p, n, e)
  chequeo('4 casillas en 2 muebles: "4 cambios sin guardar en 2 muebles"', (await contador(p)) === '4 cambios sin guardar en 2 muebles', await contador(p))
  chequeo('el título de la pestaña lleva el contador "(4) ..."', (await titulo(p)).startsWith('(4) '), await titulo(p))
  chequeo('las 4 casillas quedan destacadas como pendientes', (await pendientesVisibles(p)) === 4)
  chequeo('...y siguen marcadas en pantalla', (await estadoCasilla(p, A, 'b')).marcada && (await estadoCasilla(p, B, 'c')).marcada)
  chequeo('el SERVIDOR no ha cambiado (nada se guardó)', await srv(p, (a, b) => !window.__srv.fila(a).etapa_b && !window.__srv.fila(b).etapa_c && window.__srv.llamadas.length === 0, A, B))
  chequeo('la fila muestra el chip "Sin guardar"', (await texto(p)).includes('Sin guardar'))
  chequeo('lo pendiente queda guardado en el navegador', (await almacenado(p)).length === 1)
  await captura(p, '1-barra-escritorio')
  await casilla(p, A, 'b')
  chequeo('desmarcar una casilla recién marcada anula el cambio (3)', (await contador(p)) === '3 cambios sin guardar en 2 muebles' && (await titulo(p)).startsWith('(3) '))
  for (const [n, e] of [[A, 'i'], [B, 'b'], [B, 'c']]) await casilla(p, n, e)
  chequeo('al anular todos desaparece la barra y el contador del título', (await contador(p)) === null && !/^\(\d+\)/.test(await titulo(p)) && (await pendientesVisibles(p)) === 0)
  chequeo('...y se borra lo guardado en el navegador', (await almacenado(p)).length === 0)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 2. LISTO ================= */
await seccion('2. LISTO: cómo se ve y cómo se resume')
{
  const p = await abrir('administrador', '/pedidos')
  const antes = await texto(p)
  const porFabricarAntes = Number((antes.match(/POR FABRICAR\s*\n?\s*(\d+)/i) ?? [])[1])
  await casilla(p, A, 'listo')
  const fila = await p.evaluate((n) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes(n))?.innerText ?? '', A)
  chequeo('marcar LISTO muestra la fila como "Fabricado" y "Sin guardar"', /Fabricado/i.test(fila) && /Sin guardar/.test(fila), fila.replace(/\n/g, ' | '))
  const despues = await texto(p)
  chequeo('los contadores de arriba NO cambian hasta guardar', Number((despues.match(/POR FABRICAR\s*\n?\s*(\d+)/i) ?? [])[1]) === porFabricarAntes)
  await boton(p, 'Revisar y guardar')
  const d = await dialogo(p)
  chequeo('el resumen dice que pasa de "Por fabricar" a "Fabricado"', /1295-1/.test(d ?? '') && /Por fabricar → Fabricado/.test(d ?? ''), d)
  await boton(p, 'Volver')
  chequeo('"Volver" cierra el resumen y NO descarta nada', (await dialogo(p)) === null && (await contador(p)) === '1 cambio sin guardar en 1 mueble')
  await cerrar(p)
}

/* ================= 3. Moverse dentro de producción ================= */
await seccion('3. Moverse entre Pedidos y el detalle: nada se pierde ni avisa')
{
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, A, 'a')
  await p.evaluate((n) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes(n))?.click(), A)
  await dormir(900)
  chequeo('abrir el detalle NO muestra ningún aviso', /^\/pedidos\/[0-9a-f-]{36}$/.test(ruta(p)) && (await dialogo(p)) === null, ruta(p))
  chequeo('la barra sigue ahí con los mismos 2 cambios', (await contador(p)) === '2 cambios sin guardar en 1 mueble', await contador(p))
  chequeo('el título conserva el contador en el detalle', (await titulo(p)).startsWith('(2) '))
  const enDetalle = await p.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].filter((i) => i.closest('label')?.getAttribute('data-pendiente') === 'si').length)
  chequeo('en el detalle, B y A aparecen marcadas y destacadas', enDetalle === 2)
  await casilla(p, A, 'c')
  chequeo('marcar otra casilla en el detalle suma al mismo almacén (3)', (await contador(p)) === '3 cambios sin guardar en 1 mueble')
  await p.goBack(); await dormir(900)
  chequeo('al volver a la lista, los 3 cambios siguen ahí', ruta(p) === '/pedidos' && (await contador(p)) === '3 cambios sin guardar en 1 mueble' && (await pendientesVisibles(p)) === 3)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 4. Salir del módulo ================= */
await seccion('4. Salir del módulo de producción con cambios sin guardar')
{
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, B, 'i')
  const navLink = async (t) => p.evaluate((x) => { const a = [...document.querySelectorAll('nav a')].find((e) => e.textContent?.trim().startsWith(x)); a?.click(); return !!a }, t)
  await navLink('Inventario'); await dormir(600)
  const d = await dialogo(p)
  chequeo('ir a Inventario abre el aviso y NO cambia de página', /Tienes cambios sin guardar/.test(d ?? '') && /2 cambios/.test(d ?? '') && ruta(p) === '/pedidos', `${ruta(p)} ${d}`)
  await captura(p, '5-aviso-salida')
  await boton(p, 'Quedarme')
  chequeo('"Quedarme" cierra el aviso, sigue en Pedidos y conserva los cambios', (await dialogo(p)) === null && ruta(p) === '/pedidos' && (await contador(p)) === '2 cambios sin guardar en 2 muebles')
  await navLink('Ventas'); await dormir(600)
  chequeo('ir a Ventas también avisa', /Tienes cambios sin guardar/.test((await dialogo(p)) ?? ''))
  await p.keyboard.press('Escape'); await dormir(300)
  chequeo('Escape equivale a "Quedarme"', (await dialogo(p)) === null && ruta(p) === '/pedidos')
  await navLink('Inventario'); await dormir(500)
  await boton(p, 'Salir y descartar')
  await dormir(700)
  chequeo('"Salir y descartar" completa el cambio de página', ruta(p) === '/inventario', ruta(p))
  chequeo('...y descarta los cambios (sin contador, sin lo guardado en el navegador)', !/^\(\d+\)/.test(await titulo(p)) && (await almacenado(p)).length === 0)
  await irAPedidos(p)
  chequeo('al volver a Pedidos, las casillas están limpias', (await contador(p)) === null && (await pendientesVisibles(p)) === 0)
  chequeo('el servidor nunca recibió nada', await srv(p, () => window.__srv.llamadas.length === 0))
  await cerrar(p)
}
{
  // El botón "atrás" hacia fuera del módulo también avisa.
  const p = await abrir('administrador', '/inventario')
  await irAPedidos(p)
  await casilla(p, A, 'b')
  await p.goBack(); await dormir(600)
  chequeo('el botón "atrás" hacia Inventario también avisa', /Tienes cambios sin guardar/.test((await dialogo(p)) ?? '') && ruta(p) === '/pedidos', `${ruta(p)}`)
  await boton(p, 'Quedarme')
  chequeo('...y "Quedarme" lo deja en Pedidos con su cambio', ruta(p) === '/pedidos' && (await contador(p)) === '1 cambio sin guardar en 1 mueble')
  await cerrar(p)
}

/* ================= 5. Cerrar sesión ================= */
await seccion('5. Cerrar sesión con cambios sin guardar')
{
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, C, 'i'); await casilla(p, D, 'a')
  await p.evaluate(() => document.querySelector('button[aria-label="Salir"]')?.click()); await dormir(500)
  const d = await dialogo(p)
  chequeo('cerrar sesión avisa con el número de cambios', /Si cierras la sesión/.test(d ?? '') && /3 cambios/.test(d ?? '') && ruta(p) === '/pedidos', d)
  await boton(p, 'Seguir en la app')
  chequeo('"Seguir en la app" cancela y conserva todo', (await dialogo(p)) === null && ruta(p) === '/pedidos' && (await contador(p)) === '3 cambios sin guardar en 3 muebles')
  await p.evaluate(() => document.querySelector('button[aria-label="Salir"]')?.click()); await dormir(500)
  await boton(p, 'Cerrar sesión y descartar'); await dormir(900)
  chequeo('"Cerrar sesión y descartar" lleva a /login', ruta(p) === '/login', ruta(p))
  chequeo('...y no queda nada guardado de ese usuario', (await almacenado(p)).length === 0, JSON.stringify(await almacenado(p)))
  await cerrar(p)
}
{
  // Sin cambios, cerrar sesión es inmediato.
  const p = await abrir('administrador', '/pedidos')
  await p.evaluate(() => document.querySelector('button[aria-label="Salir"]')?.click()); await dormir(900)
  chequeo('sin cambios pendientes, cerrar sesión NO pregunta nada', ruta(p) === '/login' && (await dialogo(p)) === null, `${ruta(p)} ${await dialogo(p)}`)
  await cerrar(p)
}

/* ================= 6. Guardar ================= */
await seccion('6. Guardar: resumen, confirmación y resultado')
{
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, A, 'listo'); await casilla(p, B, 'c')
  const botonesAntes = await p.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Revisar y guardar|Descartar/.test(t)))
  chequeo('la barra ofrece "Revisar y guardar" y "Descartar" (no un "Guardar" directo)', botonesAntes.includes('Revisar y guardar') && botonesAntes.includes('Descartar') && !botonesAntes.includes('Guardar'))
  await boton(p, 'Revisar y guardar')
  const d = await dialogo(p)
  chequeo('el resumen lista cada mueble y cada casilla', /1295-1/.test(d) && /1295-2/.test(d) && /B ✔ se marca/.test(d) && /LISTO ✔ se marca/.test(d) && /C ✔ se marca/.test(d) && /3 cambios/.test(d) && /2 muebles/.test(d), d)
  await captura(p, '2-resumen-confirmacion')
  chequeo('todavía no se envió nada al servidor', await srv(p, () => window.__srv.llamadas.length === 0))
  await boton(p, 'Guardar 3 cambios')
  await dormir(900)
  chequeo('al confirmar, avisa "Se guardaron 3 cambios."', (await aviso(p))?.tipo === 'ok' && /Se guardaron 3 cambios/.test((await aviso(p))?.texto ?? ''), JSON.stringify(await aviso(p)))
  chequeo('...y la barra de cambios pendientes desaparece (solo queda el aviso)', (await contador(p)) === null && !/^\(\d+\)/.test(await titulo(p)) && (await almacenado(p)).length === 0)
  const estado = await srv(p, (a, b) => ({ a: window.__srv.fila(a), b: window.__srv.fila(b), n: window.__srv.llamadas.length }), A, B)
  chequeo('el servidor recibió UN solo lote y quedó como se pidió', estado.n === 1 && estado.a.etapa_b === true && estado.a.listo === true && estado.a.estado === 'fabricado' && estado.b.etapa_c === true, JSON.stringify(estado.a))
  chequeo('el lote llevaba orden_id, etapa, valor y esperado', await srv(p, () => window.__srv.llamadas[0].length === 3 && window.__srv.llamadas[0].every((c) => c.orden_id && c.etapa && c.valor === true && c.esperado === false)))
  chequeo('la lista se actualizó sola: 1295-1 ya figura "Fabricado" sin el chip "Sin guardar"', await p.evaluate((n) => { const tr = [...document.querySelectorAll('tbody tr')].find((x) => x.innerText.includes(n)); return !!tr && /Fabricado/i.test(tr.innerText) && !/Sin guardar/.test(tr.innerText) }, A))
  const e = await estadoCasilla(p, A, 'b')
  chequeo('...y las casillas quedan marcadas como guardadas (sin destacar)', e.marcada && !e.pendiente && (await pendientesVisibles(p)) === 0)
  await dormir(5600)
  chequeo('el aviso desaparece solo a los pocos segundos', (await aviso(p)) === null)
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}
{
  // El resumen aparece siempre, incluso con un solo cambio.
  const p = await abrir('bodega', '/pedidos')
  await casilla(p, C, 'b')
  await boton(p, 'Revisar y guardar')
  chequeo('con UN solo cambio también pide confirmación (no guarda directo)', /1295|1294-1/.test((await dialogo(p)) ?? '') && /1 cambio/.test((await dialogo(p)) ?? '') && (await srv(p, () => window.__srv.llamadas.length === 0)))
  await boton(p, 'Guardar 1 cambio')
  await dormir(700)
  chequeo('...y guarda al confirmar (bodega también puede)', await srv(p, (n) => window.__srv.fila(n).etapa_b === true, C))
  await cerrar(p)
}
{
  // LISTO quitado: advertencia en el resumen.
  const p = await abrir('administrador', '/pedidos')
  const fab = await srv(p, () => window.__srv.numeros('fabricado')[0])
  await casilla(p, fab, 'listo')
  await boton(p, 'Revisar y guardar')
  const d = await dialogo(p)
  chequeo(`quitar LISTO (${fab}): el resumen lo advierte ("Se quita LISTO: Fabricado → Por fabricar")`, /Se quita LISTO: Fabricado → Por fabricar/.test(d ?? '') && /LISTO ✘ se quita/.test(d ?? ''), d)
  await boton(p, 'Guardar 1 cambio'); await dormir(800)
  chequeo('...y al guardar vuelve a "por fabricar"', await srv(p, (n) => window.__srv.fila(n).estado === 'por_fabricar' && window.__srv.fila(n).listo === false, fab))
  await cerrar(p)
}

/* ================= 7. Conflictos ================= */
await seccion('7. Conflicto inofensivo: otra persona ya hizo el mismo cambio')
{
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b')
  await srv(p, (n) => window.__srv.otro(n, { etapa_b: true }), A)
  await boton(p, 'Revisar y guardar'); await boton(p, 'Guardar 1 cambio'); await dormir(900)
  const a = await aviso(p)
  chequeo('se trata como éxito, sin avisos de problema ni de conflicto', a?.tipo === 'ok' && (await problemas(p)).length === 0 && !/otra persona|conflicto|no se guardó/i.test(await texto(p)), JSON.stringify(a))
  chequeo('...y no queda nada pendiente', (await contador(p)) === null && (await almacenado(p)).length === 0)
  chequeo('el servidor recibió un envío (el que chocó) y no más', await srv(p, () => window.__srv.llamadas.length === 1))
  await cerrar(p)
}
{
  // Conflicto inofensivo + un cambio válido: se reintenta solo.
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, B, 'i'); await casilla(p, C, 'a')
  await srv(p, (n) => window.__srv.otro(n, { etapa_b: true }), A)
  await boton(p, 'Revisar y guardar'); await boton(p, 'Guardar 3 cambios'); await dormir(1100)
  const a = await aviso(p)
  const s = await srv(p, (b, c) => ({ b: window.__srv.fila(b).etapa_i, c: window.__srv.fila(c).etapa_a, n: window.__srv.llamadas.length, ultimo: window.__srv.llamadas.at(-1).length }), B, C)
  chequeo('conflicto inofensivo + 2 válidos: se reintenta solo con los 2 y todo queda guardado', a?.tipo === 'ok' && /Se guardaron 2 cambios/.test(a?.texto ?? '') && s.b === true && s.c === true && s.n === 2 && s.ultimo === 2, JSON.stringify([a, s]))
  chequeo('la persona no vio ningún problema', (await problemas(p)).length === 0 && (await contador(p)) === null)
  await cerrar(p)
}
await seccion('8. Problema real: el mueble ya salió a despacho')
{
  const p = await abrir('administrador', '/pedidos')
  const fab = await srv(p, () => window.__srv.numeros('fabricado')[0])
  await casilla(p, fab, 'b'); await casilla(p, B, 'b'); await casilla(p, C, 'c')
  await srv(p, (n) => window.__srv.otro(n, { estado: 'en_despacho' }), fab)
  await boton(p, 'Revisar y guardar'); await boton(p, 'Guardar 3 cambios'); await dormir(1000)
  const lista = await problemas(p)
  chequeo('se informa el problema con el número del mueble y el motivo', lista.length === 1 && lista[0].includes(fab) && /despacho/.test(lista[0]), JSON.stringify(lista))
  chequeo('dice claramente que NO se guardó nada', /No se guardó nada/.test(await texto(p)))
  const s = await srv(p, (b, c) => ({ b: window.__srv.fila(b).etapa_b, c: window.__srv.fila(c).etapa_c }), B, C)
  chequeo('ni siquiera los cambios válidos se aplicaron (todo o nada)', s.b === false && s.c === false)
  chequeo('los 3 cambios siguen pendientes, el problemático marcado en rojo', (await contador(p)) === '3 cambios sin guardar en 3 muebles' && (await estadoCasilla(p, fab, 'b')).problema === true && (await estadoCasilla(p, B, 'b')).problema === false)
  await captura(p, '3-problema-real')
  await boton(p, 'Descartar los que no se pueden aplicar')
  chequeo('"Descartar los que no se pueden aplicar" deja solo los 2 válidos', (await contador(p)) === '2 cambios sin guardar en 2 muebles' && (await problemas(p)).length === 0)
  await boton(p, 'Revisar y guardar'); await boton(p, 'Guardar 2 cambios'); await dormir(900)
  const s2 = await srv(p, (b, c) => ({ b: window.__srv.fila(b).etapa_b, c: window.__srv.fila(c).etapa_c }), B, C)
  chequeo('al guardar de nuevo, los 2 válidos se aplican', s2.b === true && s2.c === true && (await aviso(p))?.tipo === 'ok')
  await cerrar(p)
}
{
  // Un mueble que pasa a despacho DESPUÉS de cargar: se avisa antes incluso de guardar.
  const p = await abrir('administrador', '/pedidos')
  const fab = await srv(p, () => window.__srv.numeros('fabricado')[0])
  await casilla(p, fab, 'b')
  await srv(p, (n) => window.__srv.otro(n, { estado: 'en_despacho' }), fab)
  await boton(p, 'Sincronizar') // no existe en esta pantalla: se ignora
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Recargar'))?.click()); await dormir(900)
  chequeo('al recargar la lista, el cambio de un mueble que ya salió a despacho se marca en rojo', (await estadoCasilla(p, fab, 'b')).problema === true && /ya no se puede guardar/.test(await texto(p)), await contador(p))
  await cerrar(p)
}
{
  // El servidor ya trae lo que se quería (p. ej. la sincronización con Shopify): el cambio sobra.
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'listo'); await casilla(p, B, 'b')
  await srv(p, (n) => window.__srv.otro(n, { listo: true, estado: 'fabricado', listo_origen: 'shopify' }), A)
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Recargar'))?.click()); await dormir(900)
  chequeo('si el servidor ya cumplió un cambio (LISTO por Shopify), ese pendiente desaparece solo', (await contador(p)) === '1 cambio sin guardar en 1 mueble', await contador(p))
  await cerrar(p)
}

/* ================= 9. Persistencia entre sesiones ================= */
await seccion('9. Guardado en el navegador entre sesiones y aviso al recargar')
{
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, B, 'i')
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(900)
  chequeo('recargar con cambios sin guardar dispara el aviso del navegador', p.dialogos.includes('beforeunload'), JSON.stringify(p.dialogos))
  const t = await texto(p)
  chequeo('al volver, se recuperan los 2 cambios con un aviso claro', (await contador(p)) === '2 cambios sin guardar en 2 muebles' && /Recuperaste 2 cambios sin guardar de una sesión anterior/.test(t), `${await contador(p)} | ${t.slice(0, 80)}`)
  chequeo('...y las casillas vuelven a verse destacadas y marcadas', (await pendientesVisibles(p)) === 2 && (await estadoCasilla(p, A, 'b')).marcada)
  chequeo('...y el título recupera el contador', (await titulo(p)).startsWith('(2) '))
  await captura(p, '6-recuperados')
  await boton(p, 'Entendido')
  chequeo('"Entendido" oculta el aviso de recuperados pero conserva los cambios', !/Recuperaste/.test(await texto(p)) && (await contador(p)) === '2 cambios sin guardar en 2 muebles')
  const k = (await almacenado(p))[0][0]
  // Una recarga más NO debe renovar la caducidad (los 7 días cuentan desde el último cambio).
  const fecha1 = JSON.parse((await almacenado(p))[0][1]).guardadoEn
  await dormir(1100)
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(800)
  const fecha2 = JSON.parse((await almacenado(p))[0][1]).guardadoEn
  chequeo('recargar la página no renueva la fecha de caducidad de lo guardado', fecha1 === fecha2, `${fecha1} vs ${fecha2}`)
  // Caducidad: más de 7 días.
  await p.evaluate((clave) => { const d = JSON.parse(localStorage.getItem(clave)); d.guardadoEn = new Date(Date.now() - 8 * 86400000).toISOString(); localStorage.setItem(clave, JSON.stringify(d)) }, k)
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(800)
  chequeo('lo guardado hace 8 días ya no se recupera (y se borra)', (await contador(p)) === null && (await almacenado(p)).length === 0 && !/Recuperaste/.test(await texto(p)))
  await cerrar(p)
}
{
  // Otro usuario en el mismo navegador no ve los cambios del anterior.
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, B, 'i')
  await p.evaluate(() => localStorage.setItem('test-rol', 'bodega'))
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(900)
  chequeo('otro usuario (bodega) NO recibe los cambios del administrador', (await contador(p)) === null && (await pendientesVisibles(p)) === 0)
  chequeo('...y lo guardado del administrador sigue intacto en el navegador', (await almacenado(p)).some(([k]) => k.endsWith('u-administrador')))
  await p.evaluate(() => localStorage.setItem('test-rol', 'administrador'))
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(900)
  chequeo('al volver el administrador, recupera lo suyo', (await contador(p)) === '2 cambios sin guardar en 2 muebles')
  await cerrar(p)
}
{
  // Datos guardados corruptos: la app arranca normal.
  const p = await abrir('administrador', '/pedidos')
  await p.evaluate(() => localStorage.setItem('rh:pendientes:v1:u-administrador', '{esto no es json'))
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(800)
  chequeo('lo guardado corrupto se ignora: la pantalla carga normal y se limpia', (await contador(p)) === null && (await texto(p)).includes('Órdenes de fabricación') && (await almacenado(p)).length === 0 && p.errores.length === 0, p.errores.join('|'))
  await cerrar(p)
}

/* ================= 10. Descartar ================= */
await seccion('10. Descartar: confirmación solo si hay más de 3 cambios')
{
  const p = await abrir('administrador', '/pedidos')
  await casilla(p, A, 'b'); await casilla(p, A, 'i'); await casilla(p, B, 'b')
  await boton(p, 'Descartar')
  chequeo('con 3 cambios, "Descartar" actúa de inmediato', (await contador(p)) === null && (await pendientesVisibles(p)) === 0)
  for (const [n, e] of [[A, 'b'], [A, 'i'], [B, 'b'], [B, 'c']]) await casilla(p, n, e)
  await boton(p, 'Descartar')
  chequeo('con 4 cambios, pide confirmar ("¿Descartar los 4 cambios?")', /¿Descartar los 4 cambios\?/.test(await texto(p)) && (await contador(p)) === '4 cambios sin guardar en 2 muebles')
  await boton(p, 'No')
  chequeo('"No" conserva los cambios', (await contador(p)) === '4 cambios sin guardar en 2 muebles' && !/¿Descartar los 4/.test(await texto(p)))
  await boton(p, 'Descartar'); await boton(p, 'Sí, descartar')
  chequeo('"Sí, descartar" los elimina todos', (await contador(p)) === null && (await almacenado(p)).length === 0)
  chequeo('el servidor nunca recibió nada', await srv(p, () => window.__srv.llamadas.length === 0))
  await cerrar(p)
}

/* ================= 11. Detalle de un mueble ================= */
await seccion('11. Detalle de un mueble: casillas diferidas y "avanzar estado"')
{
  const p = await abrir('administrador', '/pedidos')
  const fab = await srv(p, () => window.__srv.numeros('fabricado')[0])
  const id = await srv(p, (n) => window.__srv.fila(n).id, fab)
  await p.goto(`${BASE}/pedidos/${id}`, { waitUntil: 'networkidle0' }); await dormir(900)
  const textoInicial = await texto(p)
  chequeo(`el detalle de ${fab} ofrece "Pasar a en despacho" habilitado`, await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Pasar a/.test(x.textContent)); return !!b && !b.disabled }), textoInicial.slice(0, 80))
  const bAntes = (await estadoCasilla(p, fab, 'b')).marcada
  await casilla(p, fab, 'b')
  chequeo('marcar una casilla en el detalle NO guarda: aparece la barra', (await contador(p)) === '1 cambio sin guardar en 1 mueble' && (await srv(p, () => window.__srv.llamadas.length === 0)))
  chequeo('"Pasar a ..." se desactiva y explica por qué', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Pasar a/.test(x.textContent)); return !!b && b.disabled }) && /Guarda primero los cambios de casillas/.test(await texto(p)))
  await captura(p, '7-detalle-pendiente')
  await boton(p, 'Revisar y guardar'); await boton(p, 'Guardar 1 cambio'); await dormir(900)
  chequeo('guardar desde el detalle funciona y el detalle se actualiza', (await aviso(p))?.tipo === 'ok' && (await estadoCasilla(p, fab, 'b'))?.marcada === !bAntes && !(await estadoCasilla(p, fab, 'b'))?.pendiente, `${JSON.stringify(await aviso(p))} ${JSON.stringify(await estadoCasilla(p, fab, 'b'))}`)
  chequeo('...y "Pasar a ..." vuelve a estar habilitado', await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /Pasar a/.test(x.textContent)); return !!b && !b.disabled }))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 12. Celular ================= */
await seccion('12. Celular: barra sobre la navegación inferior')
{
  const p = await abrir('bodega', '/pedidos', { ancho: 390, alto: 800 })
  await casilla(p, A, 'b'); await casilla(p, A, 'i'); await casilla(p, B, 'c')
  chequeo('en el celular también aparece la barra con el contador', (await contador(p)) === '3 cambios sin guardar en 2 muebles', await contador(p))
  const disposicion = await p.evaluate(() => {
    const barra = document.querySelector('[data-barra-cambios]')?.getBoundingClientRect()
    const nav = [...document.querySelectorAll('nav')].find((n) => n.querySelector('a') && getComputedStyle(n).borderTopWidth !== '0px')?.getBoundingClientRect()
    const vp = window.innerHeight
    return { barra: barra && { top: barra.top, bottom: barra.bottom }, nav: nav && { top: nav.top, bottom: nav.bottom }, vp, scrollX: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })
  chequeo('la barra queda justo encima de la navegación inferior, dentro de la pantalla y sin desbordar', !!disposicion.barra && !!disposicion.nav && disposicion.barra.bottom <= disposicion.nav.top + 1 && disposicion.nav.bottom <= disposicion.vp + 1 && !disposicion.scrollX, JSON.stringify(disposicion))
  await captura(p, '4-barra-celular')
  await boton(p, 'Revisar y guardar')
  await captura(p, '4b-resumen-celular')
  chequeo('el resumen cabe en la pantalla del celular', await p.evaluate(() => { const r = document.querySelector('[role=dialog]')?.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight }))
  await boton(p, 'Guardar 3 cambios'); await dormir(800)
  chequeo('guardar desde el celular funciona', (await aviso(p))?.tipo === 'ok' && (await contador(p)) === null)
  await cerrar(p)
}

try { await navegador.close() } catch { /* nada */ }
console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
