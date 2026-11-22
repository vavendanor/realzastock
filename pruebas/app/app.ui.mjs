/* El APK de bodega en pantalla real: se simula con el sufijo del user agent. Necesita el banco armado (ver README). */
import puppeteer from 'puppeteer-core'
const BASE = 'http://localhost:5180'
const SUFIJO = 'RealzaHogarApp'
let ok = 0, fallas = 0
const chequeo = (n, c, d = '') => { if (c) ok++; else { fallas++; console.log(`  FALLA ${n} ${d}`) } }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const navegador = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] })

async function abrir(rol, ruta, { app = true } = {}) {
  const p = await navegador.newPage()
  await p.setViewport({ width: 390, height: 800 })
  if (app) await p.setUserAgent((await navegador.userAgent()) + ' ' + SUFIJO)
  const errores = []
  p.on('pageerror', (e) => errores.push(String(e.message).slice(0, 160)))
  await p.evaluateOnNewDocument((r) => { if (r) localStorage.setItem('test-rol', r) }, rol)
  p.errores = errores
  await p.goto(BASE + ruta, { waitUntil: 'networkidle0' }); await dormir(600)
  return p
}
const ruta = (p) => new URL(p.url()).pathname
const texto = (p) => p.evaluate(() => document.body.innerText)
const menu = (p) => p.evaluate(() => [...document.querySelectorAll('nav:not([data-paginador]) a, nav:not([data-paginador]) button')].map((e) => e.textContent?.trim()).filter(Boolean))

console.log('== Bodega dentro del APK')
{
  const p = await abrir('bodega', '/')
  chequeo('entra directo a Pedidos', ruta(p) === '/pedidos', ruta(p))
  const m = await menu(p)
  chequeo('la barra inferior tiene solo Pedidos (sin Probador, Usuarios, Dashboard)', m.length === 1 && /^Pedidos/.test(m[0]), m.join(','))
  await p.evaluate(() => [...document.querySelectorAll('nav button')].find((b) => /^Pedidos/.test(b.textContent ?? ''))?.click()); await dormir(400)
  const opciones = await p.evaluate(() => [...document.querySelectorAll('nav a')].map((a) => a.textContent?.trim()))
  chequeo('al abrirlo: Pedidos, Hojas de fabricación y Despachos', ['Pedidos', 'Hojas de fabricación', 'Despachos'].every((x) => opciones.includes(x)) && opciones.length === 3, opciones.join(','))
  chequeo('sin errores', p.errores.length === 0, p.errores.join(' | '))
  await p.close()
  for (const r of ['/hojas', '/despachos']) { const q = await abrir('bodega', r); chequeo(`${r} funciona`, ruta(q) === r && !/solo para bodega/.test(await texto(q)), ruta(q)); await q.close() }
  for (const r of ['/usuarios', '/usuarios/nuevo', '/probador', '/inventario', '/ventas', '/xyz']) { const q = await abrir('bodega', r); chequeo(`${r} redirige al inicio (Pedidos)`, ruta(q) === '/pedidos', ruta(q)); await q.close() }
}

console.log('== Otros roles dentro del APK')
for (const rol of ['administrador', 'vendedor']) {
  for (const r of ['/', '/pedidos', '/usuarios', '/probador', '/hojas']) {
    const p = await abrir(rol, r)
    const t = await texto(p)
    const salir = await p.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Cerrar sesión/.test(b.textContent ?? '')))
    chequeo(`${rol} en ${r}: ve "Esta app es solo para bodega. Usa la versión web." y el botón`, t.includes('Esta app es solo para bodega. Usa la versión web.') && salir, t.slice(0, 80))
    chequeo(`${rol} en ${r}: sin menú, sin Dashboard, sin errores`, (await menu(p)).length === 0 && !/Dashboard/.test(t) && p.errores.length === 0, p.errores.join('|'))
    await p.close()
  }
  const p = await abrir(rol, '/')
  await p.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Cerrar sesión/.test(b.textContent ?? ''))?.click()); await dormir(900)
  chequeo(`${rol}: "Cerrar sesión" lleva a /login`, ruta(p) === '/login', ruta(p))
  await p.close()
}

console.log('== Web normal: no cambia')
{
  const a = await abrir('administrador', '/', { app: false })
  chequeo('administrador en el navegador ve su Dashboard', ruta(a) === '/' && /Dashboard/.test(await texto(a)) && !/solo para bodega/.test(await texto(a)))
  await a.goto(BASE + '/usuarios', { waitUntil: 'networkidle0' }); await dormir(400)
  chequeo('...y entra a Usuarios', ruta(a) === '/usuarios')
  await a.close()
  const b = await abrir('bodega', '/probador', { app: false })
  chequeo('bodega en el navegador sigue entrando al Probador', ruta(b) === '/probador')
  const m = await menu(b)
  chequeo('...y su menú tiene Pedidos y Probador', m.some((x) => /^Pedidos/.test(x)) && m.some((x) => /^Probador/.test(x)), m.join(','))
  await b.close()
}

await navegador.close()
console.log(`\n${ok} comprobaciones OK, ${fallas} fallas`)
process.exit(fallas ? 1 : 0)
