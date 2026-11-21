/* Paginador: lógica pura de src/lib/paginar.ts.
   Correr desde la raíz:  node --import ./pruebas/registrar-ts.mjs pruebas/paginar.test.mjs */
const P = await import(new URL('../src/lib/paginar.ts', import.meta.url).href)

let ok = 0, fallos = 0
const chequeo = (n, c, d = '') => { c ? (ok++, console.log('  OK   ', n)) : (fallos++, console.log('  FALLA', n, d)) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const lista = Array.from({ length: 95 }, (_, i) => i + 1)

chequeo('los tamaños son 20, 50 y 100, y se parte en 20', eq([...P.TAMANOS_DE_PAGINA], [20, 50, 100]) && P.POR_PAGINA_INICIAL === 20)
let r = P.paginar(lista, 1, 20)
chequeo('página 1 de 95 con 20: del 1 al 20, 5 páginas', r.items.length === 20 && r.items[0] === 1 && r.items[19] === 20 && r.desde === 1 && r.hasta === 20 && r.total === 95 && r.paginas === 5, JSON.stringify({ ...r, items: r.items.length }))
r = P.paginar(lista, 3, 20)
chequeo('página 3: del 41 al 60', r.desde === 41 && r.hasta === 60 && r.items[0] === 41)
r = P.paginar(lista, 5, 20)
chequeo('la última página trae solo lo que queda: 81–95 (15)', r.desde === 81 && r.hasta === 95 && r.items.length === 15)
chequeo('una página más allá de la última se corrige a la última', P.paginar(lista, 9, 20).pagina === 5 && P.paginar(lista, 9, 20).desde === 81)
chequeo('página 0, negativa o inválida: la 1', [0, -3, NaN].every((x) => P.paginar(lista, x, 20).pagina === 1))
r = P.paginar(lista, 1, 50)
chequeo('50 por página: 2 páginas (1–50 y 51–95); 100 por página: una sola', r.paginas === 2 && r.hasta === 50 && P.paginar(lista, 2, 50).hasta === 95 && P.paginar(lista, 1, 100).paginas === 1 && P.paginar(lista, 1, 100).hasta === 95)
r = P.paginar([], 1, 20)
chequeo('lista vacía: una página, "0–0 de 0"', r.items.length === 0 && r.desde === 0 && r.hasta === 0 && r.total === 0 && r.paginas === 1)
r = P.paginar(lista.slice(0, 20), 1, 20)
chequeo('justo 20: una sola página completa', r.paginas === 1 && r.hasta === 20 && P.paginar(lista.slice(0, 21), 1, 20).paginas === 2)
chequeo('no modifica la lista original', lista.length === 95 && lista[0] === 1)
chequeo('cuando la lista se acorta (filtros) la página se corrige: 19 elementos estando en la página 3', P.paginar(lista.slice(0, 19), 3, 20).pagina === 1)

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
