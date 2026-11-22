import puppeteer from 'puppeteer-core'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'

const BASE = 'http://localhost:5180'
const SALIDA = process.argv[2] ?? join(tmpdir(), 'resultado-router.json')
const resultados = []
const registrar = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok, detalle })
  console.log(`  ${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : '  -> ' + detalle}`)
}
const seccionBase = (t) => console.log(`\n== ${t}`)
const seccion = async (t) => { seccionBase(t); await reiniciar() }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

let navegador = null
const lanzar = () => puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
/* Un navegador limpio por sección: si Chrome se cae a mitad de la corrida, no arrastra al resto. */
async function reiniciar() {
  try { await navegador?.close() } catch { /* ya estaba cerrado */ }
  navegador = await lanzar()
}
const cerrar = async (...paginas) => { for (const p of paginas) { try { await p.close() } catch { /* el navegador ya se cerró */ } } }

/* Una pestaña nueva, con el rol ya "iniciado" (o sin sesión), y vigilando errores de la página. */
async function pestana(rol, { movil = false } = {}) {
  const p = await navegador.newPage()
  await p.setViewport(movil ? { width: 390, height: 800 } : { width: 1366, height: 900 })
  const errores = []
  p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)))
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|manifest|style property during rerender/i.test(m.text())) errores.push(m.text().slice(0, 160)) })
  await p.evaluateOnNewDocument((r) => { if (r) localStorage.setItem('test-rol', r); else localStorage.removeItem('test-rol') }, rol)
  p.errores = errores
  return p
}
const ruta = (p) => new URL(p.url()).pathname
const ir = async (p, camino) => { await p.goto(BASE + camino, { waitUntil: 'networkidle0' }); await dormir(500); return ruta(p) }
const texto = (p) => p.evaluate(() => document.body.innerText)
const hacerClic = async (p, etiqueta, selector = 'a, button') => {
  if (etiqueta === 'Pedidos' && selector === 'nav a') {
    // "Pedidos" es un desplegable: si su opción no está a la vista, se abre primero.
    const hayEnlace = await p.evaluate(() => [...document.querySelectorAll('nav a')].some((a) => a.textContent?.trim() === 'Pedidos'))
    if (!hayEnlace) { await p.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => b.textContent?.trim() === 'Pedidos')?.click()); await dormir(300) }
  }
  const ok = await p.evaluate((et, sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim().startsWith(et))
    if (!el) return false
    el.click()
    return true
  }, etiqueta, selector)
  await dormir(700)
  return ok
}
const marcarSesion = (p) => p.evaluate(() => { window.__marca = 'sigo-vivo' })
const sinRecarga = (p) => p.evaluate(() => window.__marca === 'sigo-vivo')

/* ================= A. Sin sesión ================= */
await seccion('A. Sin sesión: redirección al login')
{
  for (const [desde, esperado] of [['/pedidos', '/login'], ['/', '/login'], ['/ruta-inexistente', '/login'], ['/usuarios/nuevo', '/login'], ['/inventario/abc', '/login'], ['/pedidos/xyz/extra', '/login']]) {
    const p = await pestana(null)
    const fin = await ir(p, desde)
    registrar(`sin sesión: ${desde} -> ${esperado}`, fin === esperado, fin)
    await cerrar(p)
  }
  const p = await pestana(null)
  await ir(p, '/login')
  registrar('el login muestra el formulario', (await texto(p)).length > 0 && (await p.$('input[type=email], input[type=text], input')) !== null)
  registrar('el login no tiene errores en consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= B. Iniciar sesión por el formulario ================= */
await seccion('B. Iniciar sesión desde el formulario de login')
for (const [rol, destino] of [['administrador', '/'], ['bodega', '/pedidos'], ['vendedor', '/']]) {
  const p = await pestana(null)
  await ir(p, '/login')
  const campos = await p.$$('input')
  await campos[0].type(`${rol}@x.cl`)
  await campos[1].type('clave-de-prueba')
  await p.keyboard.press('Enter')
  await dormir(1500)
  registrar(`login como ${rol} -> ${destino}`, ruta(p) === destino, ruta(p))
  if (rol === 'vendedor') registrar('login como vendedor: ve que su cuenta no tiene acceso (no queda en blanco)', /no tiene acceso/i.test(await texto(p)), (await texto(p)).slice(0, 80))
  registrar(`login como ${rol}: la página no queda en blanco ni con errores`, (await texto(p)).trim().length > 20 && p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}
{
  // Con sesión iniciada, entrar a /login lleva a la página de inicio.
  const p = await pestana('administrador')
  const fin = await ir(p, '/login')
  registrar('con sesión, /login redirige a /', fin === '/', fin)
  await cerrar(p)
}

/* ================= C. Administrador: enlaces directos ================= */
await seccion('C. Administrador: cada ruta, entrando directo por la URL')
{
  const p = await pestana('administrador')
  const rutas = [
    ['/', 'Dashboard'], ['/inventario', 'Inventario'],
    ['/pedidos', 'Pedidos'], ['/pedidos/11111111-1111-1111-1111-111111111111', ''], ['/probador', 'Probador'], ['/usuarios', 'Usuarios'], ['/usuarios/nuevo', ''],
  ]
  for (const [r, titulo] of rutas) {
    const fin = await ir(p, r)
    const t = await texto(p)
    registrar(`admin: ${r} se queda en su ruta y muestra contenido`, fin === r && t.trim().length > 20 && (!titulo || t.includes(titulo)), `${fin} (${t.slice(0, 60).replace(/\n/g, ' ')})`)
  }
  // Ventas (pedidos manuales) y las pantallas viejas de Inventario (nuevo producto, editar) no existen: la URL escrita a mano redirige al inicio.
  for (const r of ['/inventario/nuevo', '/inventario/abc', '/ventas', '/ventas/nueva']) {
    const fin = await ir(p, r)
    registrar(`admin: ${r} (módulo oculto) redirige al inicio`, fin === '/' && (await texto(p)).includes('Dashboard'), fin)
  }
  registrar('admin: ninguna ruta produjo errores en consola', p.errores.length === 0, p.errores.slice(0, 3).join(' | '))
  await cerrar(p)
}

/* ================= D. Navegación con clic (sin recargar la página) ================= */
await seccion('D. Navegación con clic: no recarga la página')
{
  const p = await pestana('administrador')
  await ir(p, '/')
  await marcarSesion(p)
  const enlaces = await p.evaluate(() => [...document.querySelectorAll('nav a, nav button')].map((e) => e.textContent?.trim()))
  registrar('el menú del administrador tiene Inventario (de telas) y no tiene Ventas', enlaces.some((t) => /^Inventario/.test(t ?? '')) && !enlaces.some((t) => /^Ventas/.test(t ?? '')), enlaces.join(','))
  const camino = [['Pedidos', '/pedidos'], ['Probador', '/probador'], ['Usuarios', '/usuarios']]
  for (const [etiqueta, destino] of camino) {
    const hubo = await hacerClic(p, etiqueta, 'nav a')
    registrar(`clic en "${etiqueta}" del menú -> ${destino}`, hubo && ruta(p) === destino, ruta(p))
  }
  registrar('toda la navegación fue dentro de la app (sin recargar)', await sinRecarga(p))
  // Entrar al detalle de un pedido haciendo clic en una fila.
  await ir(p, '/pedidos')
  await marcarSesion(p)
  await p.evaluate(() => document.querySelector('table tbody tr')?.click())
  await dormir(800)
  registrar('clic en una fila de Pedidos abre su detalle (/pedidos/<id>)', /^\/pedidos\/[0-9a-f-]{36}$/.test(ruta(p)), ruta(p))
  registrar('...sin recargar', await sinRecarga(p))
  await p.goBack(); await dormir(600)
  registrar('"atrás" desde el detalle vuelve a /pedidos', ruta(p) === '/pedidos', ruta(p))
  registrar('...sin recargar', await sinRecarga(p))
  registrar('sin errores en consola', p.errores.length === 0, p.errores.slice(0, 3).join(' | '))
  await cerrar(p)
}

/* ================= E. Botón atrás y adelante ================= */
await seccion('E. Botón atrás y adelante')
{
  const p = await pestana('administrador')
  await ir(p, '/pedidos')
  await marcarSesion(p)
  await hacerClic(p, 'Probador', 'nav a')
  await hacerClic(p, 'Usuarios', 'nav a')
  const historial = [ruta(p)]
  await p.goBack(); await dormir(500); historial.push(ruta(p))
  await p.goBack(); await dormir(500); historial.push(ruta(p))
  registrar('atrás x2 recorre Usuarios -> Probador -> Pedidos', JSON.stringify(historial) === JSON.stringify(['/usuarios', '/probador', '/pedidos']), JSON.stringify(historial))
  await p.goForward(); await dormir(500)
  registrar('adelante vuelve a /probador', ruta(p) === '/probador', ruta(p))
  registrar('el contenido corresponde a la ruta (Probador)', (await texto(p)).includes('Probador'))
  registrar('atrás y adelante no recargaron la página', await sinRecarga(p))
  registrar('sin errores en consola', p.errores.length === 0, p.errores.slice(0, 3).join(' | '))
  await cerrar(p)
}

/* ================= F. Rutas que no existen (404) ================= */
await seccion('F. Rutas que no existen')
for (const [rol, esperado] of [['administrador', '/'], ['bodega', '/pedidos'], ['vendedor', '/']]) {
  for (const r of ['/xyz', '/pedidos/uno/dos/tres', '/inventario/nuevo/mas']) {
    const p = await pestana(rol)
    const fin = await ir(p, r)
    registrar(`${rol}: ${r} (no existe) -> ${esperado}`, fin === esperado, fin)
    await cerrar(p)
  }
}
{
  // Una URL inexistente no debe dejar un callejón sin salida en el historial: "atrás" sale de la app.
  const p = await pestana('administrador')
  await ir(p, '/pedidos')
  await p.goto(BASE + '/ruta-que-no-existe', { waitUntil: 'networkidle0' }); await dormir(500)
  const tras404 = ruta(p)
  await p.goBack(); await dormir(500)
  registrar('el 404 se reemplaza en el historial (atrás vuelve a /pedidos, no al 404)', tras404 === '/' && ruta(p) === '/pedidos', `${tras404} -> ${ruta(p)}`)
  await cerrar(p)
}

/* ================= G. Permisos por rol ================= */
await seccion('G. Permisos por rol')
{
  const casos = [
    ['bodega', '/', '/pedidos'], ['bodega', '/inventario', '/pedidos'], ['bodega', '/ventas', '/pedidos'], ['bodega', '/ventas/nueva', '/pedidos'], ['bodega', '/inventario/nuevo', '/pedidos'], ['bodega', '/usuarios', '/pedidos'], ['bodega', '/probador', '/probador'], ['bodega', '/pedidos', '/pedidos'],
    // El vendedor está oculto: toda ruta termina en el inicio, donde se le dice que no tiene acceso.
    ['vendedor', '/', '/'], ['vendedor', '/pedidos', '/'], ['vendedor', '/hojas', '/'], ['vendedor', '/despachos', '/'], ['vendedor', '/probador', '/'], ['vendedor', '/usuarios', '/'], ['vendedor', '/inventario', '/'], ['vendedor', '/ventas', '/'], ['vendedor', '/ventas/nueva', '/'],
    ['administrador', '/pedidos', '/pedidos'], ['administrador', '/usuarios', '/usuarios'], ['administrador', '/ventas', '/'], ['administrador', '/inventario', '/inventario'],
  ]
  for (const [rol, desde, esperado] of casos) {
    const p = await pestana(rol)
    const fin = await ir(p, desde)
    registrar(`${rol}: ${desde} -> ${esperado}`, fin === esperado, fin)
    if (rol === 'vendedor') {
      const t = await texto(p)
      const salir = await p.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Cerrar sesión/.test(b.textContent ?? '')))
      registrar(`vendedor: ${desde} muestra "no tiene acceso" y el botón de cerrar sesión`, /no tiene acceso/i.test(t) && salir && p.errores.length === 0, t.slice(0, 60))
    }
    await cerrar(p)
  }
  // Cerrar sesión desde la pantalla de "sin acceso".
  const pv = await pestana('vendedor')
  await ir(pv, '/')
  await pv.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Cerrar sesión/.test(b.textContent ?? ''))?.click()); await dormir(900)
  registrar('vendedor: "Cerrar sesión" lo lleva a /login', ruta(pv) === '/login', ruta(pv))
  await cerrar(pv)
}

/* ================= H. Cerrar sesión ================= */
await seccion('H. Cerrar sesión')
{
  const p = await pestana('administrador')
  await ir(p, '/probador')
  await marcarSesion(p)
  await hacerClic(p, 'Pedidos', 'nav a')
  const hubo = await p.evaluate(() => { const b = document.querySelector('button[aria-label="Salir"]'); if (!b) return false; b.click(); return true }); await dormir(900)
  registrar('cerrar sesión lleva a /login', hubo && ruta(p) === '/login', `${hubo} ${ruta(p)}`)
  registrar('...sin recargar la página', await sinRecarga(p))
  await p.goBack(); await dormir(700)
  registrar('"atrás" tras cerrar sesión no deja ver una pantalla protegida (termina en /login)', ruta(p) === '/login', ruta(p))
  registrar('sin errores en consola', p.errores.length === 0, p.errores.slice(0, 3).join(' | '))
  await cerrar(p)
}

/* ================= I. Recarga en una ruta profunda ================= */
await seccion('I. Recargar la página en una ruta profunda')
{
  const p = await pestana('bodega')
  await ir(p, '/pedidos')
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(400)
  registrar('recargar en /pedidos se queda en /pedidos', ruta(p) === '/pedidos', ruta(p))
  const p2 = await pestana('administrador')
  await ir(p2, '/usuarios/nuevo')
  await p2.reload({ waitUntil: 'networkidle0' }); await dormir(400)
  registrar('recargar en /usuarios/nuevo se queda ahí', ruta(p2) === '/usuarios/nuevo', ruta(p2))
  await cerrar(p, p2)
}

/* ================= J. Celular (barra inferior) ================= */
await seccion('J. Celular: barra inferior de navegación')
{
  const p = await pestana('administrador', { movil: true })
  await ir(p, '/')
  await marcarSesion(p)
  const barra = await p.evaluate(() => [...document.querySelectorAll('nav a, nav button')].map((e) => e.textContent?.trim()))
  registrar('móvil: la barra inferior tiene Inventario y no tiene Ventas', barra.some((t) => /^Inventario/.test(t ?? '')) && !barra.some((t) => /^Ventas/.test(t ?? '')), barra.join(','))
  for (const [etiqueta, destino] of [['Probador', '/probador'], ['Pedidos', '/pedidos'], ['Usuarios', '/usuarios']]) {
    const hubo = await hacerClic(p, etiqueta, 'nav a')
    registrar(`móvil: toque en "${etiqueta}" -> ${destino}`, hubo && ruta(p) === destino, ruta(p))
  }
  await p.goBack(); await dormir(500)
  registrar('móvil: atrás vuelve a /pedidos', ruta(p) === '/pedidos', ruta(p))
  registrar('móvil: sin recargar y sin errores', (await sinRecarga(p)) && p.errores.length === 0, p.errores.slice(0, 3).join(' | '))
  const pb = await pestana('bodega', { movil: true })
  await ir(pb, '/')
  registrar('móvil bodega: entra a /pedidos', ruta(pb) === '/pedidos', ruta(pb))
  await cerrar(p); await cerrar(pb)
}

await cerrar()
try { await navegador.close() } catch { /* nada */ }
const fallas = resultados.filter((r) => !r.ok)
writeFileSync(SALIDA, JSON.stringify(resultados.map((r) => [r.nombre, r.ok]), null, 1))
console.log(`\n${resultados.length - fallas.length} comprobaciones OK, ${fallas.length} fallas`)
process.exit(fallas.length ? 1 : 0)
