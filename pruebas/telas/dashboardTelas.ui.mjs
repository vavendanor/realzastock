/* Dashboard (piezas atrasadas y telas con stock bajo) e Inventario de telas, en pantalla real y por rol.
   Necesita el banco armado (ver README). Correr desde la raíz:
   node --import ./pruebas/registrar-ts.mjs pruebas/telas/dashboardTelas.ui.mjs */
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
import { piezasAtrasadas } from '../../src/lib/atrasados.ts'
import { crearCalendario, hoyEnChile } from '../../src/lib/diasHabiles.ts'
import { aplanarOrden } from '../../src/lib/ordenes.ts'

const BASE = 'http://localhost:5180'
let ok = 0, fallas = 0
const chequeo = (n, c, d = '') => { if (c) ok++; else { fallas++; console.log(`  FALLA ${n} ${d}`) } }
const sec = (t) => console.log(`\n== ${t}`)
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const navegador = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-gpu'] })

const datos = JSON.parse(readFileSync(new URL('../arnes/datos.json', import.meta.url), 'utf8'))
const hoy = hoyEnChile()
const esperadas = piezasAtrasadas(datos.ordenes.map((o) => aplanarOrden({ ...o, shopify_preparado: false, listo_origen: o.listo ? 'app' : null, plazo_desde: null })), crearCalendario(['2026-10-12', '2026-10-31', '2026-11-01']), hoy).piezas
/* Todas las que siguen por fabricar (también los cojines adicionales, que cuentan para el plazo). */
const porFabricar = datos.ordenes.filter((o) => o.estado === 'por_fabricar' && !o.cancelado_en).map((o) => o.numero)
const nombresClientes = [...new Set(datos.clientes.map((c) => c.cliente).filter(Boolean))]

/* `telas`: se siembran en localStorage antes de cargar. `app`: simula el APK con el sufijo del user agent. */
async function abrir(rol, ruta, { app = false, movil = false, telas = null, prepara = null } = {}) {
  const p = await navegador.newPage()
  await p.setViewport(movil ? { width: 390, height: 800 } : { width: 1366, height: 900 })
  if (app) await p.setUserAgent((await navegador.userAgent()) + ' RealzaHogarApp')
  p.errores = []
  p.on('pageerror', (e) => p.errores.push(String(e.message).slice(0, 160)))
  /* Cada pantalla parte de cero: sin telas ajustadas ni pedidos cambiados por una prueba anterior. */
  await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await p.evaluate(() => { localStorage.removeItem('test-telas'); localStorage.removeItem('test-srv') })
  await p.evaluateOnNewDocument((r, t) => { if (r) localStorage.setItem('test-rol', r); if (t) localStorage.setItem('test-telas', JSON.stringify(t)) }, rol, telas)
  await p.goto(BASE + ruta, { waitUntil: 'networkidle0' }); await dormir(700)
  if (prepara) { await prepara(p); await p.reload({ waitUntil: 'networkidle0' }); await dormir(700) }
  return p
}
const ruta = (p) => new URL(p.url()).pathname
const texto = (p) => p.evaluate(() => document.body.innerText)
const menu = (p) => p.evaluate(() => [...document.querySelectorAll('nav:not([data-paginador]) a, nav:not([data-paginador]) button')].map((e) => e.textContent?.trim()).filter(Boolean))
const telasBase = (nombre, metros, minimo) => ['Lino', 'Cuero', 'Semicuero', 'Tela hidrorepelente'].map((n, i) => ({ id: `tela-${i + 1}`, numero: n, nombre: n, metros: n === nombre ? metros : 100, stock_minimo: n === nombre ? minimo : 30 }))

sec('Piezas atrasadas en el Dashboard')
chequeo('hay piezas atrasadas en los datos de octubre (si no, la prueba no prueba nada)', esperadas.length > 0, String(esperadas.length))
{
  const p = await abrir('administrador', '/')
  const filas = await p.evaluate(() => [...document.querySelectorAll('[data-pieza-atrasada]')].map((f) => ({ numero: f.getAttribute('data-pieza-atrasada'), dias: Number(f.querySelector('[data-dias-atraso]').getAttribute('data-dias-atraso')), texto: f.innerText })))
  chequeo(`muestra las ${esperadas.length} piezas atrasadas, ni una más ni una menos`, filas.length === esperadas.length, `${filas.length}`)
  chequeo('en el mismo orden: de la más atrasada a la menos', JSON.stringify(filas.map((f) => f.numero)) === JSON.stringify(esperadas.map((e) => e.numero)))
  chequeo('los días de atraso son los de la regla (14 días hábiles con feriados)', JSON.stringify(filas.map((f) => f.dias)) === JSON.stringify(esperadas.map((e) => e.dias)))
  chequeo('cada fila dice "Atrasado N días"', filas.every((f, i) => f.texto.includes(`Atrasado ${f.dias} ${f.dias === 1 ? 'día' : 'días'}`)))
  const muestra = esperadas[0]
  chequeo('cada fila lleva número de pedido, modelo y comuna', filas[0].texto.includes(muestra.numero) && filas[0].texto.includes(muestra.modelo) && (muestra.comuna === '—' || filas[0].texto.includes(muestra.comuna)), filas[0].texto.replace(/\n/g, ' | '))
  const t = await texto(p)
  chequeo('sin nombre de cliente en ninguna parte del Dashboard', !nombresClientes.some((c) => t.includes(c)), nombresClientes.find((c) => t.includes(c)))
  chequeo('el cuadro resumen cuenta lo mismo', (await p.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.innerText?.startsWith('Piezas atrasadas') && d.innerText.length < 80)?.innerText ?? '')).includes(String(esperadas.length)))
  chequeo('sin errores', p.errores.length === 0, p.errores.join(' | '))
  await p.evaluate(() => document.querySelector('[data-pieza-atrasada]').click()); await dormir(700)
  chequeo('tocar una pieza abre su detalle', /^\/pedidos\/[0-9a-f-]{36}$/.test(ruta(p)), ruta(p))
  await p.close()
}
{
  // Mismo Dashboard en celular: la alerta se ve y no desborda a los lados.
  const p = await abrir('administrador', '/', { movil: true })
  chequeo('celular: se ven las piezas atrasadas', (await p.$$('[data-pieza-atrasada]')).length === esperadas.length)
  chequeo('celular: sin desborde horizontal', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await p.close()
}
{
  const p = await abrir('administrador', '/', {
    prepara: (pg) => pg.evaluate((h, numeros) => { for (const n of numeros) window.__srv.otro(n, { plazo_desde: h }) }, hoy, porFabricar),
  })
  const t = await texto(p)
  chequeo('sin piezas atrasadas: mensaje claro', /No hay piezas atrasadas/.test(t) && (await p.$$('[data-pieza-atrasada]')).length === 0)
  chequeo('...y el cuadro resumen en 0', (await p.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.innerText?.startsWith('Piezas atrasadas') && d.innerText.length < 80)?.innerText ?? '')).includes('0'))
  await p.close()
}

sec('Alerta de stock bajo en el Dashboard')
{
  const p = await abrir('administrador', '/')
  chequeo('con 100 m y mínimo 30 no hay alerta: mensaje claro', /Ninguna tela está en su mínimo/.test(await texto(p)) && (await p.$$('[data-tela-baja]')).length === 0)
  await p.close()
}
{
  const p = await abrir('administrador', '/', { telas: telasBase('Cuero', 30, 30) })
  const bajas = await p.evaluate(() => [...document.querySelectorAll('[data-tela-baja]')].map((f) => f.innerText.replace(/\n/g, ' | ')))
  chequeo('en el mínimo exacto (30 de 30) avisa, con nombre, cantidad y mínimo', bajas.length === 1 && bajas[0].includes('Cuero') && bajas[0].includes('30 m') && /mínimo 30 m/.test(bajas[0]), bajas.join('#'))
  await p.close()
}
{
  const telas = telasBase('Lino', 12.5, 30).map((t) => (t.nombre === 'Semicuero' ? { ...t, metros: 5 } : t))
  const p = await abrir('administrador', '/', { telas })
  const bajas = await p.evaluate(() => [...document.querySelectorAll('[data-tela-baja]')].map((f) => f.getAttribute('data-tela-baja')))
  chequeo('dos telas bajo el mínimo: salen las dos, la más escasa primero', JSON.stringify(bajas) === JSON.stringify(['Semicuero', 'Lino']), bajas.join())
  chequeo('con decimales: "12,5 m"', (await texto(p)).includes('12,5 m'))
  chequeo('el cuadro resumen dice 2 de 4 telas', /2\s*\n?.*de 4 telas/.test(await p.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.innerText?.startsWith('Telas con stock bajo') && d.innerText.length < 90)?.innerText ?? '')))
  chequeo('no aparecen sofás, ventas ni precios en el Dashboard', !/Productos con stock bajo|Ventas del día|\$\s?\d/.test(await texto(p)))
  await p.close()
}

sec('Inventario de telas (administrador)')
{
  const p = await abrir('administrador', '/inventario')
  chequeo('entra a /inventario', ruta(p) === '/inventario', ruta(p))
  const tarjetas = await p.evaluate(() => [...document.querySelectorAll('[data-tela]')].map((t) => t.getAttribute('data-tela')))
  chequeo('muestra solo 4 telas: Lino, Cuero, Semicuero y Tela hidrorepelente', JSON.stringify([...tarjetas].sort()) === JSON.stringify(['Cuero', 'Lino', 'Semicuero', 'Tela hidrorepelente']), tarjetas.join())
  const t = await texto(p)
  chequeo('con 100 m cada una y mínimo 30', (t.match(/Hay 100 m · mínimo 30 m/g) ?? []).length === 4)
  chequeo('sin sofás, ventas, precios ni botón de nuevo producto', !/Nuevo producto|SKU|Showroom|Precio|\$\s?\d|Ventas/i.test(t.replace('Alertas', '')), t.slice(0, 200))
  chequeo('ninguna alerta con los datos iniciales', (await p.$$('[data-alerta-stock]')).length === 0)

  /* Se busca el campo de nuevo cada vez: al aparecer o quitarse un aviso, React puede rehacer el campo. */
  const escribir = async (nombre, i, valor) => {
    const campo = (await p.$$(`[data-tela="${nombre}"] input`))[i]
    await campo.focus()
    await p.keyboard.down('Control'); await p.keyboard.press('a'); await p.keyboard.up('Control')
    await p.keyboard.press('Backspace')
    if (valor) await p.keyboard.type(valor)
  }
  const METROS = 0, MINIMO = 1
  const botonHabilitado = async (nombre) => p.evaluate((n) => { const b = [...document.querySelectorAll(`[data-tela="${n}"] button`)].find((x) => /Guardar/.test(x.textContent ?? '')); return !!b && !b.disabled }, nombre)
  const pulsar = (nombre) => p.evaluate((n) => [...document.querySelectorAll(`[data-tela="${n}"] button`)].find((x) => /Guardar/.test(x.textContent ?? ''))?.click(), nombre)

  chequeo('Guardar está apagado mientras no se cambia nada', !(await botonHabilitado('Lino')))
  await escribir('Lino', METROS, '-5')
  chequeo('un número negativo se rechaza (Guardar apagado y aviso)', !(await botonHabilitado('Lino')) && /Número de 0 o más/.test(await texto(p)))
  await escribir('Lino', METROS, 'abc')
  chequeo('un texto tampoco', !(await botonHabilitado('Lino')))
  await escribir('Lino', METROS, '')
  chequeo('vacío tampoco', !(await botonHabilitado('Lino')))
  await escribir('Lino', METROS, '72,5')
  await escribir('Lino', MINIMO, '25')
  chequeo('con valores válidos, Guardar se enciende', await botonHabilitado('Lino'))
  await pulsar('Lino'); await dormir(700)
  chequeo('al guardar, la tarjeta muestra los nuevos valores', (await texto(p)).includes('Hay 72,5 m · mínimo 25 m'))
  chequeo('...y Guardar vuelve a apagarse', !(await botonHabilitado('Lino')))
  const servidor = await p.evaluate(() => window.__srv.telas().find((t) => t.nombre === 'Lino'))
  chequeo('la base recibió 72,5 y 25', servidor.metros === 72.5 && servidor.stock_minimo === 25, JSON.stringify(servidor))
  await p.reload({ waitUntil: 'networkidle0' }); await dormir(600)
  chequeo('tras recargar, sigue ahí', (await texto(p)).includes('Hay 72,5 m · mínimo 25 m'))
  // Bajarla al mínimo enciende la alerta de la tarjeta.
  await escribir('Cuero', METROS, '30'); await pulsar('Cuero'); await dormir(700)
  chequeo('al dejar una tela en su mínimo (30 de 30), su tarjeta muestra "Stock bajo"', (await p.$$('[data-tela="Cuero"] [data-alerta-stock]')).length === 1)
  await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await dormir(600)
  chequeo('y el Dashboard la avisa', (await p.$$('[data-tela-baja="Cuero"]')).length === 1)
  chequeo('sin errores', p.errores.length === 0, p.errores.join(' | '))
  await p.close()
}
{
  const p = await abrir('administrador', '/inventario', { movil: true })
  chequeo('celular: 4 tarjetas, sin desborde horizontal', (await p.$$('[data-tela]')).length === 4 && (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)))
  await p.close()
}

sec('Quién ve el inventario y el Dashboard')
{
  const p = await abrir('administrador', '/')
  const m = await menu(p)
  chequeo('administrador: el menú tiene Inventario (y no Ventas)', m.some((x) => /^Inventario/.test(x)) && !m.some((x) => /^Ventas/.test(x)), m.join(','))
  await p.close()
}
for (const [rol, app, nombre] of [['bodega', false, 'bodega (web)'], ['bodega', true, 'bodega en el APK']]) {
  const p = await abrir(rol, '/inventario', { app })
  chequeo(`${nombre}: /inventario redirige a Pedidos`, ruta(p) === '/pedidos', ruta(p))
  chequeo(`${nombre}: no ve el inventario ni sus datos`, !/Inventario|Lino|Semicuero/.test((await texto(p)).replace(/Inventario de/g, '')) && (await p.$$('[data-tela]')).length === 0)
  const m = await menu(p)
  chequeo(`${nombre}: su menú no tiene Inventario`, !m.some((x) => /^Inventario/.test(x)), m.join(','))
  await p.goto(BASE + '/', { waitUntil: 'networkidle0' }); await dormir(500)
  chequeo(`${nombre}: "/" lleva a Pedidos, no al Dashboard`, ruta(p) === '/pedidos' && !/Pedidos atrasados|Telas con stock bajo/.test(await texto(p)), ruta(p))
  await p.close()
}
for (const [rol, app] of [['administrador', true], ['vendedor', false], ['vendedor', true]]) {
  const p = await abrir(rol, '/inventario', { app })
  const t = await texto(p)
  chequeo(`${rol}${app ? ' en el APK' : ''}: no ve telas ni Dashboard`, (await p.$$('[data-tela]')).length === 0 && !/Pedidos atrasados|Telas con stock bajo|Lino/.test(t), t.slice(0, 80))
  await p.close()
}
{
  const p = await abrir('bodega', '/')
  const llamadasTelas = await p.evaluate(() => window.__srv.llamadasHojas.filter((l) => l.op === 'ajustar_tela').length)
  chequeo('bodega no llama a ajustar_tela', llamadasTelas === 0)
  chequeo('la tabla de telas no entrega filas a bodega (RLS)', await p.evaluate(async () => { const m = await import('/preview-tmp/supabaseFalso.ts'); const r = await m.supabase.from('telas').select('id'); return (r.data ?? []).length === 0 }))
  const r = await p.evaluate(async () => { const m = await import('/preview-tmp/supabaseFalso.ts'); return (await m.supabase.rpc('ajustar_tela', { p_tela_id: 'tela-1', p_metros: 1, p_stock_minimo: 1 })).error?.message ?? null })
  chequeo('bodega no puede ajustar una tela (la función lo rechaza)', /Solo el administrador/.test(r ?? ''), String(r))
  await p.close()
}

await navegador.close()
console.log(`\n${ok} comprobaciones OK, ${fallas} fallas`)
process.exit(fallas ? 1 : 0)
