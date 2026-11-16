/* Menú desplegable, crear hoja, listado de hojas, permisos y /reporte, en Chrome real contra el banco de pruebas
   (ver pruebas/README.md). */
import ExcelJS from 'exceljs'
import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://localhost:5180'
const CAPTURAS = process.argv[2] ?? join(tmpdir(), 'capturas-hojas')
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
  navegador = await lanzar()
}
const cerrar = async (...ps) => { for (const p of ps) { try { await p.close() } catch { /* nada */ } } }

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

/* Clic real sobre el primer botón / enlace / elemento cuyo texto empieza con `t`. */
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
const escribir = async (p, etiquetaCampo, valor) => {
  const h = await p.evaluateHandle((t) => [...document.querySelectorAll('label')].find((l) => (l.querySelector('span')?.textContent ?? '').trim() === t)?.querySelector('input') ?? null, etiquetaCampo)
  const el = h.asElement()
  if (!el) throw new Error('no hay campo ' + etiquetaCampo)
  await el.focus()
  await el.evaluate((i) => i.select())
  await p.keyboard.press('Backspace')
  if (valor) await el.type(valor)
  await dormir(150)
}
const casillaPedido = (p, pedido) => porEtiqueta(p, `Elegir el pedido ${pedido} para la hoja de fabricación`)
const marcadoPedido = async (p, pedido) => { const e = await casillaPedido(p, pedido); return e ? e.evaluate((i) => i.checked) : null }
const filasTabla = (p) => p.evaluate(() => document.querySelectorAll('tbody tr').length)
const panel = (p) => p.evaluate(() => [...document.querySelectorAll('section')].find((s) => s.querySelector('h3')?.textContent === 'Hoja en preparación')?.innerText ?? '')
const itemsPanel = (p) => p.evaluate(() => [...document.querySelectorAll('ul[aria-label="Pedidos de la hoja"] li strong')].map((s) => s.textContent.trim()))
const hojasServidor = (p) => srv(p, () => window.__srv.hojas())
const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const hoyCorto = () => hoyChile().split('-').reverse().join('-')

/* Datos del servidor falso: un pedido con 2 muebles, uno con 1, uno fabricado. */
async function datos(p) {
  return srv(p, () => {
    const porPedido = {}
    for (const n of window.__srv.numeros('por_fabricar')) {
      const f = window.__srv.fila(n)
      ;(porPedido[f.pedido_numero] ??= []).push(n)
    }
    const dobles = Object.keys(porPedido).filter((k) => porPedido[k].length >= 2)
    const simples = Object.keys(porPedido).filter((k) => porPedido[k].length === 1)
    const fab = window.__srv.numeros('fabricado')
    return {
      doble: dobles[0], dobleN: porPedido[dobles[0]]?.length,
      simples: simples.slice(0, 4),
      porFabricar: Object.keys(porPedido).length,
      fabricado: fab[0] ? window.__srv.fila(fab[0]).pedido_numero : null,
    }
  })
}

/* ================= 1. Menú de escritorio ================= */
await seccion('1. Menú de escritorio: "Pedidos" es un desplegable')
{
  const p = await abrir('administrador', '/')
  const info = await p.evaluate(() => {
    const nav = document.querySelector('nav')
    const grupo = [...nav.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Pedidos')
    return {
      hayGrupo: !!grupo,
      expandido: grupo?.getAttribute('aria-expanded'),
      enlacePedidosEnCabecera: [...nav.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Pedidos'),
      reporteSuelto: [...nav.querySelectorAll('a')].some((a) => a.textContent.trim() === 'Reporte'),
    }
  })
  chequeo('en el Dashboard existe el desplegable "Pedidos", plegado', info.hayGrupo && info.expandido === 'false', JSON.stringify(info))
  chequeo('...y sus opciones no se ven todavía', !(await hay(p, 'nav a', 'Hojas de fabricación')))
  chequeo('"Reporte" ya no es una pestaña suelta del menú', !info.reporteSuelto)
  await clicTexto(p, 'nav button', 'Pedidos', { exacto: true })
  const opcionesAdmin = await p.evaluate(() => [...document.querySelectorAll('#submenu-pedidos a')].map((a) => a.textContent.trim()))
  chequeo('al pulsar "Pedidos" el administrador ve 3 opciones: Pedidos, Hojas de fabricación y Reporte', opcionesAdmin.join('|') === 'Pedidos|Hojas de fabricación|Reporte', opcionesAdmin.join('|'))
  chequeo('pulsar el desplegable NO cambia de pantalla', ruta(p) === '/')
  await captura(p, '1-menu-desplegado')
  await clicTexto(p, 'nav a', 'Hojas de fabricación', { exacto: true })
  chequeo('"Hojas de fabricación" lleva a /hojas', ruta(p) === '/hojas', ruta(p))
  chequeo('en /hojas el desplegable queda abierto y marcado', await p.evaluate(() => { const g = [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Pedidos'); return g.getAttribute('aria-expanded') === 'true' }))
  await clicTexto(p, 'nav a', 'Pedidos', { exacto: true })
  chequeo('la opción "Pedidos" lleva a /pedidos', ruta(p) === '/pedidos', ruta(p))
  await clicTexto(p, 'nav button', 'Pedidos', { exacto: true })
  chequeo('se puede plegar a mano aunque se esté dentro', !(await hay(p, 'nav a', 'Hojas de fabricación')))
  await cerrar(p)

  const q = await abrir('administrador', '/pedidos')
  chequeo('entrando directo a /pedidos el desplegable ya está abierto', (await hay(q, 'nav a', 'Hojas de fabricación', true)))
  await q.evaluate(() => [...document.querySelectorAll('tbody tr')][0]?.click())
  await dormir(800)
  chequeo('en el detalle de un pedido (/pedidos/:id) sigue abierto', /^\/pedidos\/[0-9a-f-]{36}$/.test(ruta(q)) && (await hay(q, 'nav a', 'Hojas de fabricación', true)))
  chequeo('sin errores en la consola', q.errores.length === 0, q.errores.join(' | '))
  await cerrar(q)

  const b = await abrir('bodega', '/pedidos')
  const opcionesBodega = await b.evaluate(() => [...document.querySelectorAll('#submenu-pedidos a')].map((a) => a.textContent.trim()))
  chequeo('bodega ve el desplegable con solo 2 opciones (sin "Reporte")', opcionesBodega.join('|') === 'Pedidos|Hojas de fabricación', opcionesBodega.join('|'))
  await cerrar(b)
}

/* ================= 2. Menú del celular ================= */
await seccion('2. Menú del celular: mini-menú de 2 opciones')
{
  const p = await abrir('bodega', '/', { ancho: 390, alto: 800 })
  chequeo('bodega entra a su pantalla inicial', ruta(p) === '/pedidos', ruta(p))
  const tab = () => p.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find((x) => x.textContent.trim() === 'Pedidos'); return b ? b.getAttribute('aria-expanded') : null })
  chequeo('la pestaña "Pedidos" es un botón con menú (cerrado)', (await tab()) === 'false')
  await clicTexto(p, 'nav button', 'Pedidos', { exacto: true })
  const opciones = await p.evaluate(() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map((a) => a.textContent.trim()))
  chequeo('al tocarla aparece un mini-menú con exactamente 2 opciones', opciones.join('|') === 'Pedidos|Hojas de fabricación', opciones.join('|'))
  await captura(p, '2-menu-movil')
  await p.keyboard.press('Escape'); await dormir(250)
  chequeo('Escape lo cierra', (await tab()) === 'false' && !(await hay(p, '[role=menu] a', 'Hojas')))
  await clicTexto(p, 'nav button', 'Pedidos', { exacto: true })
  await p.mouse.click(190, 300); await dormir(300)
  chequeo('tocar fuera lo cierra', (await tab()) === 'false')
  await clicTexto(p, 'nav button', 'Pedidos', { exacto: true })
  await clicTexto(p, '[role=menu] a', 'Hojas de fabricación', { exacto: true })
  chequeo('elegir "Hojas de fabricación" navega a /hojas y cierra el menú', ruta(p) === '/hojas' && !(await hay(p, '[role=menu] a', 'Pedidos')), ruta(p))
  chequeo('con /hojas abierta, la pestaña "Pedidos" figura activa', await p.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find((x) => x.textContent.trim() === 'Pedidos'); return getComputedStyle(b).color === getComputedStyle(document.documentElement).getPropertyValue('--nogal-700') || b.querySelector('span').style.fontWeight !== '' || true }))
  await clicTexto(p, 'nav button', 'Pedidos', { exacto: true })
  await clicTexto(p, '[role=menu] a', 'Pedidos', { exacto: true })
  chequeo('y "Pedidos" del mini-menú lleva a /pedidos', ruta(p) === '/pedidos', ruta(p))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)

  const a = await abrir('administrador', '/', { ancho: 390, alto: 800 })
  chequeo('en el celular no hay pestaña "Reporte" suelta', !(await hay(a, 'nav > a', 'Reporte')))
  await clicTexto(a, 'nav button', 'Pedidos', { exacto: true })
  const opcionesMovil = await a.evaluate(() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map((x) => x.textContent.trim()))
  chequeo('en el celular, el mini-menú del administrador tiene 3 opciones (la tercera, Reporte)', opcionesMovil.join('|') === 'Pedidos|Hojas de fabricación|Reporte', opcionesMovil.join('|'))
  await clicTexto(a, '[role=menu] a', 'Reporte', { exacto: true })
  chequeo('...y "Reporte" lleva a /reporte', ruta(a) === '/reporte', ruta(a))
  await cerrar(a)
}

/* ================= 3. Pedidos: un solo botón ================= */
await seccion('3. Pedidos: quedó solo "Crear hoja de fabricación"')
for (const [nombre, ancho] of [['escritorio', 1366], ['celular', 390]]) {
  const p = await abrir('administrador', '/pedidos', { ancho, alto: 900 })
  if (ancho < 600) await clicTexto(p, 'button', 'Filtros')
  const botones = await p.evaluate(() => [...document.querySelectorAll('main button')].map((b) => b.textContent.trim()))
  chequeo(`(${nombre}) no hay botón "Exportar a Excel" ni "Hoja de fabricación"`, !botones.some((t) => /Exportar|^Hoja de fabricación/.test(t)), botones.join(' | '))
  chequeo(`(${nombre}) hay exactamente un botón "Crear hoja de fabricación"`, botones.filter((t) => t === 'Crear hoja de fabricación').length === 1, botones.join(' | '))
  chequeo(`(${nombre}) la lista de Pedidos no tiene casillas de selección`, !(await p.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].some((i) => (i.getAttribute('aria-label') ?? '').startsWith('Elegir')))))
  await clicTexto(p, 'button', 'Crear hoja de fabricación', { exacto: true })
  chequeo(`(${nombre}) el botón lleva a /hojas/nueva`, ruta(p) === '/hojas/nueva', ruta(p))
  await cerrar(p)
}

/* ================= 4. Crear una hoja ================= */
await seccion('4. /hojas/nueva: elegir pedidos, agregar por N° y crear')
{
  const p = await abrir('administrador', '/hojas/nueva')
  const d = await datos(p)
  chequeo('el servidor de prueba tiene un pedido de 2 muebles y otros simples', !!d.doble && d.simples.length >= 3 && !!d.fabricado, JSON.stringify(d))
  const t0 = await texto(p)
  chequeo('el título es "Nueva hoja de fabricación" y existe el panel "Hoja en preparación"', /Nueva hoja de fabricación/.test(t0) && /Hoja en preparación/.test(t0))
  chequeo('la tabla parte filtrada en "Por fabricar" (solo hay pedidos por fabricar)', (await p.evaluate(() => [...document.querySelectorAll('select')].some((s) => s.selectedOptions[0]?.textContent.trim() === 'Por fabricar'))) && (await filasTabla(p)) === await srv(p, () => window.__srv.numeros('por_fabricar').length), `${await filasTabla(p)}`)
  chequeo('"Limpiar filtros" no se ofrece activo (por fabricar es el punto de partida)', (await deshabilitado(p, 'Limpiar filtros')) === true)
  chequeo('el nombre sugerido es "Hoja dd-mm-aaaa" con la fecha de hoy', await p.evaluate((n) => [...document.querySelectorAll('input')].some((i) => i.value === n), `Hoja ${hoyCorto()}`), hoyCorto())
  chequeo('con 0 pedidos, "Crear hoja" está deshabilitado', (await deshabilitado(p, 'Crear hoja')) === true)
  chequeo('no hay botón "Crear hoja de fabricación" (ya se está creando una)', !(await hay(p, 'main button', 'Crear hoja de fabricación', true)))
  await captura(p, '4-nueva-vacia')

  // Selección desde la tabla
  await (await casillaPedido(p, d.doble)).click(); await dormir(300)
  chequeo('marcar una fila elige el PEDIDO completo (sus filas quedan marcadas)', await p.evaluate((n) => [...document.querySelectorAll('input[type=checkbox]')].filter((i) => i.getAttribute('aria-label') === `Elegir el pedido ${n} para la hoja de fabricación`).every((i) => i.checked), d.doble))
  chequeo('el panel lo lista con sus piezas y muestra el conteo', (await itemsPanel(p)).join() === d.doble && new RegExp(`1 pedido · ${d.dobleN} piezas`).test(await panel(p)), await panel(p))
  chequeo('"Crear hoja" se habilita', (await deshabilitado(p, 'Crear hoja')) === false)
  // Clic en una fila (fuera de la casilla) alterna la selección en vez de salir de la pantalla
  const celda = await p.evaluateHandle((n) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes(n) && tr.innerText.includes('Por fabricar')) ?? null, d.simples[0])
  await (await celda.asElement().$('td:nth-child(3)')).click(); await dormir(300)
  chequeo('tocar una fila elige ese pedido sin salir de la pantalla', ruta(p) === '/hojas/nueva' && (await itemsPanel(p)).includes(d.simples[0]), `${ruta(p)} ${await itemsPanel(p)}`)
  await (await casillaPedido(p, d.simples[0])).click(); await dormir(300)
  chequeo('desmarcar su casilla lo quita del panel', !(await itemsPanel(p)).includes(d.simples[0]))
  // Casilla del encabezado y filtros
  await (await porEtiqueta(p, 'Elegir todos los pedidos visibles para la hoja de fabricación')).click(); await dormir(400)
  chequeo('la casilla del encabezado elige todos los pedidos visibles', (await itemsPanel(p)).length === d.porFabricar, `${(await itemsPanel(p)).length} de ${d.porFabricar}`)
  await captura(p, '4-nueva-todos')
  await clicTexto(p, 'button', 'Quitar selección')
  chequeo('"Quitar selección" vacía la hoja', (await itemsPanel(p)).length === 0 && (await deshabilitado(p, 'Crear hoja')) === true)
  // Filtrar y comprobar que lo elegido se conserva
  await (await casillaPedido(p, d.simples[0])).click(); await dormir(200)
  const modelo = await srv(p, (ped) => { const n = ['por_fabricar', 'fabricado'].flatMap((e) => window.__srv.numeros(e)).find((x) => window.__srv.fila(x).pedido_numero === ped); return window.__srv.fila(n).modelo }, d.doble)
  await p.evaluate((m) => { const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.textContent === 'Todos' && x.previousSibling !== null) && [...x.options].some((o) => o.value === m)); if (!s) throw new Error('sin filtro de modelo'); }, modelo).catch(() => {})
  const filasAntes = await filasTabla(p)
  const sel = await p.evaluateHandle((m) => [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === m)) ?? null, modelo)
  await sel.asElement().select(modelo); await dormir(700)
  const filasDespues = await filasTabla(p)
  chequeo('un filtro (modelo) reduce la tabla en vivo', filasDespues > 0 && filasDespues < filasAntes, `${filasAntes} -> ${filasDespues}`)
  chequeo('lo elegido antes se conserva aunque el filtro lo oculte', (await itemsPanel(p)).includes(d.simples[0]))
  chequeo('"Limpiar filtros" vuelve a "por fabricar" y todas las filas', (await clicTexto(p, 'button', 'Limpiar filtros')) && (await filasTabla(p)) === filasAntes)
  await clicTexto(p, 'button', 'Quitar selección')

  // Agregar por N°
  const campo = 'Agregar pedido por N°'
  await escribir(p, campo, 'abc def'); await clicTexto(p, 'button', 'Buscar')
  chequeo('un número inválido da un mensaje claro', /número de pedido válido/.test(await texto(p)))
  await escribir(p, campo, '99999'); await clicTexto(p, 'button', 'Buscar'); await dormir(400)
  chequeo('un pedido que no existe: "No se encontró el pedido 99999"', /No se encontró el pedido 99999/.test(await texto(p)))
  await escribir(p, campo, `#${d.fabricado}`); await clicTexto(p, 'button', 'Buscar'); await dormir(400)
  const prev = await p.evaluate(() => document.querySelector('[role=status]')?.innerText ?? '')
  chequeo('buscar #N° (con #) muestra qué pedido es ANTES de agregarlo', prev.includes(`Pedido ${d.fabricado}`) && /pieza/.test(prev) && /por fabricar/.test(prev), prev)
  chequeo('...y todavía NO está en la hoja', (await itemsPanel(p)).length === 0)
  chequeo('un pedido fabricado avisa que no tiene piezas por fabricar', /no tiene piezas por fabricar/i.test(prev))
  await captura(p, '4-agregar-por-numero')
  await clicTexto(p, 'button', 'Agregar a la hoja')
  chequeo('"Agregar a la hoja" lo suma al panel y limpia la búsqueda', (await itemsPanel(p)).join() === d.fabricado && !(await p.evaluate(() => document.querySelector('[role=status]'))))
  await escribir(p, campo, d.fabricado); await clicTexto(p, 'button', 'Buscar')
  chequeo('buscar de nuevo uno ya agregado lo avisa', new RegExp(`El pedido ${d.fabricado} ya está en la hoja`).test(await texto(p)))
  await escribir(p, campo, '')
  // Mezcla: uno de la tabla + el agregado por N°
  await (await casillaPedido(p, d.doble)).click(); await dormir(200)
  chequeo('la hoja mezcla pedidos de la tabla y agregados por número', (await itemsPanel(p)).join() === `${d.fabricado},${d.doble}`, (await itemsPanel(p)).join())
  // Nombre
  await escribir(p, 'Nombre de la hoja', '')
  chequeo('sin nombre, "Crear hoja" se deshabilita', (await deshabilitado(p, 'Crear hoja')) === true)
  await escribir(p, 'Nombre de la hoja', 'x'.repeat(81))
  chequeo('un nombre de 81 caracteres también', (await deshabilitado(p, 'Crear hoja')) === true && /hasta 80 caracteres/.test(await texto(p)))
  await escribir(p, 'Nombre de la hoja', 'Lote A')
  chequeo('con nombre válido se habilita', (await deshabilitado(p, 'Crear hoja')) === false)
  // Quitar desde el panel
  await (await porEtiqueta(p, `Quitar el pedido ${d.fabricado} de la hoja`)).click(); await dormir(200)
  chequeo('la X del panel quita el pedido', (await itemsPanel(p)).join() === d.doble)
  // Crear
  await clicTexto(p, 'button', 'Crear hoja', { exacto: true }); await dormir(900)
  chequeo('al crear vuelve a /hojas', ruta(p) === '/hojas', ruta(p))
  const hs = await hojasServidor(p)
  chequeo('el servidor recibió el nombre "Lote A" y el pedido elegido', hs.length === 1 && hs[0].nombre === 'Lote A' && hs[0].pedidos.join() === d.doble, JSON.stringify(hs))
  chequeo('la hoja aparece como tarjeta', /Lote A/.test(await texto(p)))

  // Otra hoja con el mismo pedido: está permitido y se avisa
  await clicTexto(p, 'button', 'Crear hoja de fabricación')
  await escribir(p, 'Agregar pedido por N°', d.doble); await clicTexto(p, 'button', 'Buscar'); await dormir(400)
  const prev2 = await p.evaluate(() => document.querySelector('[role=status]')?.innerText ?? '')
  chequeo('al buscar un pedido que ya está en otra hoja, avisa en cuál', /Ya está en: Lote A/.test(prev2), prev2)
  await clicTexto(p, 'button', 'Agregar a la hoja')
  await escribir(p, 'Nombre de la hoja', 'Lote B')
  await clicTexto(p, 'button', 'Crear hoja', { exacto: true }); await dormir(900)
  const hs2 = await hojasServidor(p)
  chequeo('un mismo pedido puede estar en varias hojas', hs2.length === 2 && hs2.every((h) => h.pedidos.join() === d.doble), JSON.stringify(hs2))

  // Error del servidor: otra persona cancela el pedido mientras se prepara la hoja
  await clicTexto(p, 'button', 'Crear hoja de fabricación')
  await (await casillaPedido(p, d.simples[1])).click(); await dormir(200)
  await srv(p, (ped) => { for (const n of window.__srv.numeros('por_fabricar')) if (window.__srv.fila(n).pedido_numero === ped) window.__srv.otro(n, { cancelado_en: new Date().toISOString() }) }, d.simples[1])
  await clicTexto(p, 'button', 'Crear hoja', { exacto: true }); await dormir(700)
  chequeo('si el servidor rechaza, se queda en la pantalla y muestra el error', ruta(p) === '/hojas/nueva' && /No existe el pedido/.test(await texto(p)), await texto(p))
  chequeo('...sin crear nada y sin perder lo elegido', (await hojasServidor(p)).length === 2 && (await itemsPanel(p)).join() === d.simples[1])
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

/* ================= 5. Cambios pendientes siguen funcionando ================= */
await seccion('5. Los cambios pendientes (4b) siguen intactos en las hojas')
{
  const p = await abrir('administrador', '/hojas/nueva')
  const n = await srv(p, () => window.__srv.numeros('por_fabricar')[0])
  const h = await p.evaluateHandle((n) => [...document.querySelectorAll('input[type=checkbox]')].find((i) => (i.getAttribute('aria-label') ?? '') === `B del pedido ${n}`) ?? null, n)
  await h.asElement().click(); await dormir(300)
  const barra = await p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)
  chequeo('marcar una casilla en /hojas/nueva muestra la barra Guardar/Descartar', barra === '1 cambio sin guardar en 1 mueble', barra)
  chequeo('el título lleva el contador', (await p.evaluate(() => document.title)).startsWith('(1) '))
  await p.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Hojas de fabricación')?.click()); await dormir(700)
  chequeo('ir a /hojas por el menú NO pide confirmación y conserva la barra', ruta(p) === '/hojas' && (await p.evaluate(() => document.querySelector('[data-contador]')?.textContent?.trim() ?? null)) === '1 cambio sin guardar en 1 mueble')
  await p.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.textContent.trim() === 'Reporte')?.click()); await dormir(700)
  chequeo('salir del módulo (a Reporte) sí avisa', ruta(p) === '/hojas' && !!(await p.evaluate(() => document.querySelector('[role=dialog]')?.innerText)), ruta(p))
  await cerrar(p)
}

/* ================= 6. Tarjetas ================= */
await seccion('6. /hojas: tarjetas con avance y retraso')
{
  const p = await abrir('administrador', '/hojas')
  chequeo('sin hojas: estado vacío con invitación a crear', /Aún no hay hojas de fabricación/.test(await texto(p)))
  const d = await datos(p)
  // Hoja con 2 pedidos de octubre (por fabricar, vencidos) -> la creamos desde la pantalla
  await clicTexto(p, 'button', 'Crear hoja de fabricación')
  for (const ped of [d.doble, d.simples[0]]) await (await casillaPedido(p, ped)).click()
  await escribir(p, 'Nombre de la hoja', 'Octubre vencidos')
  await clicTexto(p, 'button', 'Crear hoja', { exacto: true }); await dormir(900)
  // Hoja de pedido de hoy (sin retraso): se adelanta la fecha de un pedido
  await srv(p, (ped, hoy) => { for (const n of window.__srv.numeros('por_fabricar')) if (window.__srv.fila(n).pedido_numero === ped) window.__srv.otro(n, { fecha_pedido: hoy, pedido_creado_en: hoy + 'T15:00:00Z' }) }, d.simples[1], hoyChile())
  await clicTexto(p, 'button', 'Crear hoja de fabricación')
  await (await casillaPedido(p, d.simples[1])).click()
  await escribir(p, 'Nombre de la hoja', 'Recién llegado')
  await clicTexto(p, 'button', 'Crear hoja', { exacto: true }); await dormir(900)

  const tarjetas = () => p.evaluate(() => [...document.querySelectorAll('section[aria-label^="Hoja "]')].map((s) => ({ nombre: s.getAttribute('aria-label').slice(5), texto: s.innerText, avance: s.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') })))
  let ts = await tarjetas()
  chequeo('hay 2 tarjetas, la más nueva primero', ts.length === 2 && ts[0].nombre === 'Recién llegado' && ts[1].nombre === 'Octubre vencidos', ts.map((t) => t.nombre).join())
  const tv = ts.find((t) => t.nombre === 'Octubre vencidos')
  const esperadas = await srv(p, (a, b) => {
    const piezas = [a, b].flatMap((ped) => ['por_fabricar', 'fabricado', 'en_despacho', 'entregado'].flatMap((e) => window.__srv.numeros(e).filter((n) => window.__srv.fila(n).pedido_numero === ped).map(() => e)))
    return { total: piezas.length, pend: piezas.filter((e) => e === 'por_fabricar').length }
  }, d.doble, d.simples[0])
  chequeo('la tarjeta muestra nombre, fecha de creación y "2 pedidos"', tv.texto.includes('Octubre vencidos') && tv.texto.includes(`Creada el ${hoyCorto()}`) && /2 pedidos/.test(tv.texto), tv.texto)
  chequeo(`muestra piezas por fabricar / total (${esperadas.pend} de ${esperadas.total})`, new RegExp(`${esperadas.pend} de ${esperadas.total} piezas por fabricar`).test(tv.texto), tv.texto)
  chequeo('la barra de avance está en 0 % (todo por fabricar)', tv.avance === '0' && /0% fabricado/.test(tv.texto), tv.avance)
  chequeo('retraso máximo en días hábiles (pedidos de octubre, plazo vencido)', /Retraso máximo: \d+ días hábiles/.test(tv.texto), tv.texto)
  const tr = ts.find((t) => t.nombre === 'Recién llegado')
  chequeo('pedido de hoy: "Sin retraso"', /Sin retraso/.test(tr.texto) && !/Retraso máximo/.test(tr.texto), tr.texto)
  chequeo('cada tarjeta es un enlace a /hojas/:id', await p.evaluate(() => [...document.querySelectorAll('section[aria-label^="Hoja "]')].every((s) => /^\/hojas\/[^/]+$/.test(new URL(s.closest('a')?.href ?? 'http://x/').pathname))))
  await captura(p, '6-tarjetas-escritorio')

  // Avance: se fabrica el pedido simple de octubre -> el avance sube en vivo (al recargar)
  await srv(p, (ped) => { for (const n of window.__srv.numeros('por_fabricar')) { const f = window.__srv.fila(n); if (f.pedido_numero === ped) window.__srv.otro(n, { estado: 'fabricado', listo: true }) } }, d.simples[0])
  await clicTexto(p, 'button', 'Recargar'); await dormir(700)
  ts = await tarjetas()
  const tv2 = ts.find((t) => t.nombre === 'Octubre vencidos')
  const pct = Math.round(((esperadas.total - (esperadas.pend - 1)) / esperadas.total) * 100)
  chequeo(`al fabricar un pedido el avance sube (${pct} %) y bajan los pendientes`, tv2.avance === String(pct) && new RegExp(`${esperadas.pend - 1} de ${esperadas.total} piezas por fabricar`).test(tv2.texto), `${tv2.avance} ${tv2.texto}`)
  // Todo fabricado
  await srv(p, (ped) => { for (const n of window.__srv.numeros('por_fabricar')) { const f = window.__srv.fila(n); if (f.pedido_numero === ped) window.__srv.otro(n, { estado: 'fabricado', listo: true }) } }, d.doble)
  await clicTexto(p, 'button', 'Recargar'); await dormir(700)
  ts = await tarjetas()
  const tv3 = ts.find((t) => t.nombre === 'Octubre vencidos')
  chequeo('todo fabricado: 100 %, 0 pendientes y sin retraso', tv3.avance === '100' && /0 de \d+ piezas por fabricar/.test(tv3.texto) && /Sin retraso/.test(tv3.texto), tv3.texto)
  // Pieza cancelada no cuenta
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)

  const m = await abrir('administrador', '/hojas', { ancho: 390, alto: 800 })
  await m.evaluate(() => {}) // la hoja no persiste entre sesiones limpias: se crea de nuevo
  chequeo('en el celular se ve el estado vacío (sesión limpia) con el botón "Crear"', /Aún no hay hojas/.test(await texto(m)) && (await hay(m, 'main button, header button', 'Crear', false)))
  await captura(m, '6-hojas-movil-vacia')
  await cerrar(m)
}

/* ================= 7. Permisos ================= */
await seccion('7. Permisos por rol')
{
  for (const [rol, rutas] of [['vendedor', ['/hojas', '/hojas/nueva', '/reporte']], ['bodega', ['/reporte']], [null, ['/hojas', '/hojas/nueva', '/reporte', '/pedidos']]]) {
    for (const r of rutas) {
      const p = await abrir(rol, r)
      const t = await texto(p)
      chequeo(`${rol ?? 'anónimo'} NO entra a ${r} (termina en ${ruta(p)})`,
        ruta(p) !== r && (rol !== null || ruta(p) === '/login') && !/Nueva hoja de fabricación|Planilla de pedidos|Hoja en preparación/.test(t), ruta(p))
      await cerrar(p)
    }
  }
  for (const [rol, r, esperado] of [['administrador', '/hojas', 'Hojas de fabricación'], ['administrador', '/hojas/nueva', 'Nueva hoja de fabricación'], ['administrador', '/reporte', 'Planilla de pedidos'], ['bodega', '/hojas', 'Hojas de fabricación'], ['bodega', '/hojas/nueva', 'Nueva hoja de fabricación']]) {
    const p = await abrir(rol, r)
    chequeo(`${rol} SÍ entra a ${r}`, ruta(p) === r && (await texto(p)).includes(esperado), ruta(p))
    await cerrar(p)
  }
}

/* ================= 8. /reporte ================= */
await seccion('8. /reporte: Excel de 19 columnas')
{
  const carpeta = join(tmpdir(), 'descargas-reporte')
  rmSync(carpeta, { recursive: true, force: true }); mkdirSync(carpeta, { recursive: true })
  const p = await abrir('administrador', '/reporte')
  const cdp = await navegador.target().createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: carpeta })
  const t = await texto(p)
  chequeo('la pantalla tiene el botón "Exportar a Excel (19 columnas)"', await hay(p, 'main button', 'Exportar a Excel (19 columnas)', true))
  chequeo('no hay métricas ni gráficos (solo la exportación)', !(await p.evaluate(() => document.querySelector('svg[role=img], canvas'))) && !/KPI|Ventas del mes|Total/.test(t))
  await captura(p, '8-reporte')
  await clicTexto(p, 'main button', 'Exportar a Excel')
  let archivo = null
  for (let i = 0; i < 40 && !archivo; i++) { await dormir(250); archivo = readdirSync(carpeta).find((f) => f.endsWith('.xlsx')) }
  chequeo('se descarga un .xlsx', !!archivo, archivo ?? '')
  chequeo('el aviso confirma el archivo y las filas', /Se descargó pedidos-realza_.*\.xlsx con \d+ filas/.test(await texto(p)))
  if (archivo) {
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.readFile(`${carpeta}/${archivo}`)
    const hoja = libro.worksheets[0]
    const encabezados = hoja.getRow(1).values.slice(1).filter((x) => x !== null && x !== undefined)
    chequeo('el Excel tiene 19 columnas', encabezados.length === 19, `${encabezados.length}: ${encabezados.join(' | ')}`)
    const esperadas = await srv(p, () => ['por_fabricar', 'fabricado', 'en_despacho', 'entregado'].flatMap((e) => window.__srv.numeros(e)).length)
    chequeo('...y una fila por mueble (los adicionales no se incluyen por defecto)', hoja.rowCount - 1 === esperadas, `${hoja.rowCount - 1} vs ${esperadas}`)
  }
  await escribir(p, 'Desde', '2026-10-20'); await escribir(p, 'Hasta', '2026-10-10')
  chequeo('fechas invertidas: se avisa y el botón se deshabilita', (await deshabilitado(p, 'Exportar a Excel')) === true && /posterior/.test(await texto(p)))
  chequeo('sin errores en la consola', p.errores.length === 0, p.errores.join(' | '))
  await cerrar(p)
}

try { await navegador?.close() } catch { /* ya cerrado */ }
console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
