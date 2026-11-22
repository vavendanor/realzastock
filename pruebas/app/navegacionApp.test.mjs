/* Menú y rutas del APK de bodega (lógica pura). Correr desde la raíz:
   node --import ./pruebas/registrar-ts.mjs pruebas/app/navegacionApp.test.mjs */
import * as N from '../../src/components/layout/navegacion.ts'
import * as P from '../../src/lib/plataforma.ts'

let ok = 0, fallas = 0
const chequeo = (nombre, cond, detalle = '') => { if (cond) ok++; else { fallas++; console.log(`  FALLA ${nombre} ${detalle}`) } }
const etiquetas = (rol, enApp) => N.navParaRol(rol, enApp).map((i) => i.label).join('|')
const hijos = (rol, enApp) => N.navParaRol(rol, enApp).flatMap((i) => i.hijos?.map((h) => h.label) ?? []).join('|')

console.log('== Dentro del APK')
chequeo('bodega: el menú es solo "Pedidos" (con Pedidos, Hojas de fabricación y Despachos)', etiquetas('bodega', true) === 'Pedidos' && hijos('bodega', true) === 'Pedidos|Hojas de fabricación|Despachos', etiquetas('bodega', true))
chequeo('bodega: sin Dashboard, Usuarios ni Probador', !/Dashboard|Usuarios|Probador/.test(etiquetas('bodega', true)))
for (const rol of ['administrador', 'vendedor', null]) chequeo(`${rol}: el menú del APK está vacío`, N.navParaRol(rol, true).length === 0)

console.log('== Web normal (no cambia)')
chequeo('bodega: Pedidos y Probador, como siempre', etiquetas('bodega', false) === 'Pedidos|Probador de colores', etiquetas('bodega', false))
chequeo('administrador: Dashboard, Inventario, Pedidos, Probador y Usuarios', etiquetas('administrador', false) === 'Dashboard|Inventario|Pedidos|Probador de colores|Usuarios', etiquetas('administrador', false))
chequeo('vendedor: sin menú', N.navParaRol('vendedor', false).length === 0)

console.log('== Rutas permitidas en el APK')
for (const r of ['/pedidos', '/pedidos/abc', '/hojas', '/hojas/nueva', '/hojas/abc', '/despachos']) chequeo(`${r} está permitida`, N.rutaPermitidaEnApp(r))
for (const r of ['/', '/usuarios', '/usuarios/nuevo', '/probador', '/inventario', '/ventas', '/xyz', '/pedidosx']) chequeo(`${r} no está permitida (redirige al inicio)`, !N.rutaPermitidaEnApp(r))
chequeo('bodega entra por "/" a /pedidos', N.rutaInicial('bodega') === '/pedidos')

console.log('== Detección del APK')
chequeo('esApp() es false en Node (sin Capacitor ni sufijo)', P.esApp() === false)
const antes = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: `Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile ${P.SUFIJO_USER_AGENT_APP}` }, configurable: true })
chequeo('esApp() es true con el sufijo en el user agent', P.esApp() === true)
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile' }, configurable: true })
chequeo('esApp() es false con un Chrome móvil normal', P.esApp() === false)
if (antes) Object.defineProperty(globalThis, 'navigator', antes)
chequeo('el sufijo coincide con capacitor.config.ts', (await import('node:fs')).readFileSync('capacitor.config.ts', 'utf8').includes(`'${P.SUFIJO_USER_AGENT_APP}'`))

console.log(`\n${ok} comprobaciones OK, ${fallas} fallas`)
process.exit(fallas ? 1 : 0)
