/* Inventario de telas y alerta de stock bajo (lógica pura). Correr desde la raíz:
   node --import ./pruebas/registrar-ts.mjs pruebas/telas/telas.test.mjs */
import { estaBajoMinimo, formatearMetros, leerMetros, telasEnAlerta } from '../../src/lib/telas.ts'

let ok = 0, fallas = 0
const chequeo = (nombre, cond, detalle = '') => { if (cond) ok++; else { fallas++; console.log(`  FALLA ${nombre} ${detalle}`) } }
const sec = (t) => console.log(`\n== ${t}`)
const tela = (nombre, metros, stockMinimo) => ({ id: nombre, nombre, metros, stockMinimo })

sec('Cuándo una tela está en alerta')
chequeo('sobre el mínimo: no (31 de 30)', !estaBajoMinimo(tela('Lino', 31, 30)))
chequeo('justo en el mínimo: sí (30 de 30)', estaBajoMinimo(tela('Lino', 30, 30)))
chequeo('bajo el mínimo: sí (29,5 de 30)', estaBajoMinimo(tela('Lino', 29.5, 30)))
chequeo('sin metros: sí', estaBajoMinimo(tela('Lino', 0, 30)))
chequeo('con mínimo 0 solo avisa si se acabó', !estaBajoMinimo(tela('Lino', 1, 0)) && estaBajoMinimo(tela('Lino', 0, 0)))

sec('La lista de alertas')
const todas = [tela('Lino', 100, 30), tela('Cuero', 30, 30), tela('Semicuero', 10, 30), tela('Tela hidrorepelente', 80, 30)]
chequeo('solo salen las que están en o bajo su mínimo (Cuero y Semicuero)', telasEnAlerta(todas).map((t) => t.nombre).sort().join() === 'Cuero,Semicuero')
chequeo('la más escasa primero (Semicuero a 20 m del mínimo, antes que Cuero en el mínimo)', telasEnAlerta(todas).map((t) => t.nombre).join() === 'Semicuero,Cuero')
chequeo('si ninguna está en alerta, la lista está vacía (el Dashboard muestra el mensaje)', telasEnAlerta([tela('Lino', 100, 30), tela('Cuero', 31, 30)]).length === 0)
chequeo('no modifica la lista original', todas.map((t) => t.nombre).join() === 'Lino,Cuero,Semicuero,Tela hidrorepelente')
chequeo('con los datos iniciales (100 m, mínimo 30) no hay alertas', telasEnAlerta(['Lino', 'Cuero', 'Semicuero', 'Tela hidrorepelente'].map((n) => tela(n, 100, 30))).length === 0)

sec('Leer y mostrar metros')
chequeo('"72,5" y "72.5" valen 72,5', leerMetros('72,5') === 72.5 && leerMetros('72.5') === 72.5)
chequeo('enteros, ceros y espacios: "100", "0", " 30 "', leerMetros('100') === 100 && leerMetros('0') === 0 && leerMetros(' 30 ') === 30)
chequeo('hasta 2 decimales', leerMetros('10,25') === 10.25 && leerMetros('10,255') === null)
for (const malo of ['', '   ', '-5', 'abc', '1,2,3', '1e3', '5 m', ',5']) chequeo(`rechaza "${malo}"`, leerMetros(malo) === null)
chequeo('formato: "100 m" y "72,5 m"', formatearMetros(100) === '100 m' && formatearMetros(72.5) === '72,5 m', `${formatearMetros(100)} ${formatearMetros(72.5)}`)

console.log(`\n${ok} comprobaciones OK, ${fallas} fallas`)
process.exit(fallas ? 1 : 0)
