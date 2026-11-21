/* Los SQL de pedidos de prueba del orden y paginador de Despachos (insertar y borrar), sobre las migraciones reales
   (PGlite), y el orden/paginación REAL de la app aplicado a lo que dejan esos pedidos.
   Correr desde la raíz:  node --import ./pruebas/registrar-ts.mjs pruebas/despachos/scriptsSqlOrden.test.mjs */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
const Dp = await import(new URL('../../src/lib/despachos.ts', import.meta.url).href)
const O = await import(new URL('../../src/lib/ordenes.ts', import.meta.url).href)
const P = await import(new URL('../../src/lib/paginar.ts', import.meta.url).href)

let ok = 0, fallos = 0
const chequeo = (n, c, d = '') => { c ? (ok++, console.log('  OK   ', n)) : (fallos++, console.log('  FALLA', n, d)) }
const sec = (t) => console.log(`\n== ${t}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const db = new PGlite()
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`)
const DIR = `${RAIZ}supabase/migrations`
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql') && !f.startsWith('0011')).sort()) {
  let sql = readFileSync(`${DIR}/${f}`, 'utf8')
  if (f.startsWith('0014')) sql = sql.split('-- PARTE 2: programación cada 5 minutos')[0]
  await db.exec(sql)
}
const q = async (sql, args) => (await db.query(sql, args)).rows
const correr = async (sql) => (await db.exec(sql)).at(-1).rows
const leer = (n) => readFileSync(`${RAIZ}supabase/verificacion/${n}`, 'utf8')
await db.exec(`insert into ordenes_fabricacion (numero, pedido_numero, shopify_order_id, shopify_line_item_id, unidad, tipo, modelo, pedido_creado_en, origen_shopify)
  values ('1300', '1300', 'gid://shopify/Order/1300', 'gid://shopify/LineItem/1', 1, 'SOFÁ', 'OSORNO', '2026-10-30T15:00:00Z', 'web')`)

sec('despachos_orden_de_prueba_insertar.sql')
const insertar = leer('despachos_orden_de_prueba_insertar.sql')
let r = await correr(insertar)
chequeo('termina mostrando los 42 muebles cargados', r.length === 42, String(r.length))
const filas = await q(`select to_jsonb(o) as j from ordenes_fabricacion o where shopify_order_id like 'TEST-T93%' order by numero`)
const crudas = filas.map((x) => x.j)
chequeo('42 muebles, todos de origen "prueba" y con identificación TEST-', crudas.length === 42 && crudas.every((o) => o.origen_shopify === 'prueba' && o.shopify_order_id.startsWith('TEST-')))
const reg = (c) => [...new Set(crudas.filter((o) => o.comuna === c).map((o) => o.region))].join()
chequeo('la base asigna la región de cada comuna (Viña → Valparaíso, Concepción → Biobío, Puerto Montt → Los Lagos...)', reg('Viña del Mar') === 'Valparaíso' && reg('Concepción') === 'Biobío' && reg('Antofagasta') === 'Antofagasta' && reg('Puerto Montt') === 'Los Lagos' && reg('Providencia') === 'Metropolitana de Santiago' && reg('Ñuñoa') === 'Metropolitana de Santiago' && reg('Las Condes') === 'Metropolitana de Santiago', JSON.stringify(['Viña del Mar', 'Concepción', 'Puerto Montt', 'Providencia'].map(reg)))
chequeo('6 muebles en cada una de las 6 comunas principales (+1 Providencia con plazo cambiado)', ['Ñuñoa', 'Las Condes', 'Viña del Mar', 'Concepción', 'Antofagasta'].every((c) => crudas.filter((o) => o.comuna === c).length === 6) && crudas.filter((o) => o.comuna === 'Providencia').length === 9)
chequeo('hay un retiro, un sin dirección, un cancelado y uno por fabricar', crudas.some((o) => o.comuna === 'RETIRO TIENDA') && crudas.some((o) => /NO SE PROPORCION/.test(o.comuna)) && crudas.some((o) => o.cancelado_en) && crudas.some((o) => o.estado === 'por_fabricar'))
const fechas = crudas.filter((o) => /^T93[0-3]\d$/.test(o.numero) && Number(o.numero.slice(1)) <= 9335).map((o) => o.fecha_pedido)
chequeo('los 36 pedidos de las comunas tienen 36 antigüedades distintas, sin coincidir con el orden de los números', new Set(fechas).size === 36 && !eq([...fechas], [...fechas].sort()) && !eq([...fechas], [...fechas].sort().reverse()))
chequeo('T9341 es de hace 40 días pero con el plazo contado desde ayer', (() => { const o = crudas.find((x) => x.numero === 'T9341'); return o.plazo_desde > o.fecha_pedido && o.estado === 'fabricado' })())
await correr(insertar)
chequeo('ejecutarlo otra vez NO duplica nada', (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id like 'TEST-T93%'`))[0].n === 42)

sec('El orden y la paginación de la app sobre esos pedidos')
const ordenes = crudas.map((j) => O.aplanarOrden(j))
const g = Dp.agruparPorDestino(ordenes)
chequeo('regiones: Metropolitana primero y después Antofagasta, Biobío, Los Lagos y Valparaíso', eq(g.regiones.map((x) => x.nombre), ['Metropolitana de Santiago', 'Antofagasta', 'Biobío', 'Los Lagos', 'Valparaíso']), g.regiones.map((x) => x.nombre).join())
chequeo('comunas de la Metropolitana en orden: Las Condes, Ñuñoa, Providencia', eq(g.regiones[0].comunas.map((c) => c.nombre), ['Las Condes', 'Ñuñoa', 'Providencia']))
const despachables = ordenes.filter(Dp.esDespachable)
chequeo('en Despachos entran 40 muebles (no el cancelado ni el por fabricar) y el retiro y el sin dirección van aparte', despachables.length === 40 && g.retiros.length === 1 && g.sinDireccion.length === 1 && g.regiones.reduce((s, x) => s + x.total, 0) === 38)
let ordenOk = true
for (const reg of g.regiones) for (const c of reg.comunas) {
  const esperado = [...c.muebles].sort((a, b) => ((a.plazoDesde ?? a.fechaPedido) < (b.plazoDesde ?? b.fechaPedido) ? -1 : (a.plazoDesde ?? a.fechaPedido) > (b.plazoDesde ?? b.fechaPedido) ? 1 : Number(a.numero.slice(1)) - Number(b.numero.slice(1)))).map((o) => o.numero)
  if (!eq(c.muebles.map((o) => o.numero), esperado)) ordenOk = false
}
chequeo('dentro de cada comuna: del más antiguo al más nuevo (fecha del pedido o inicio del plazo)', ordenOk)
const prov = g.regiones[0].comunas.find((c) => c.nombre === 'Providencia').muebles.map((o) => o.numero)
chequeo('T9341 (pedido de hace 40 días con plazo desde ayer) queda al final de Providencia', prov.at(-1) === 'T9341' && prov.length === 7, prov.join())
const sinPlazo = prov.filter((n) => n !== 'T9341')
chequeo('en Providencia el orden sigue la antigüedad: no es el orden por número, ni ascendente ni descendente', sinPlazo.join() !== [...sinPlazo].sort().join() && sinPlazo.join() !== [...sinPlazo].sort().reverse().join(), prov.join())
const lista = Dp.aplanarDespachos(g)
const p1 = P.paginar(lista, 1, 20), p2 = P.paginar(lista, 2, 20)
chequeo('con 20 por página: 2 páginas, "1–20 de 40" y "21–40 de 40"', p1.paginas === 2 && p1.desde === 1 && p1.hasta === 20 && p2.desde === 21 && p2.hasta === 40 && p1.total === 40)
const b1 = Dp.bloquesDeFilas(p1.items), b2 = Dp.bloquesDeFilas(p2.items)
chequeo('un grupo queda cortado entre las dos páginas: el último de la 1 "sigue" y el primero de la 2 "continúa" (mismo grupo)', b1.at(-1).sigue === true && b2[0].continua === true && b1.at(-1).claveGrupo === b2[0].claveGrupo, `${b1.at(-1).titulo} / ${b2[0].titulo}`)
chequeo('entre las dos páginas están los 40 muebles, cada uno una vez', new Set([...b1, ...b2].flatMap((b) => b.muebles.map((o) => o.numero))).size === 40 && [...b1, ...b2].flatMap((b) => b.muebles).length === 40)
chequeo('con 50 por página: una sola página con los 40', P.paginar(lista, 1, 50).paginas === 1 && P.paginar(lista, 1, 50).hasta === 40)

sec('despachos_orden_de_prueba_borrar.sql')
await db.exec(`insert into hojas_fabricacion (id, nombre) values ('00000000-0000-4000-8000-0000000000aa', 'Hoja real'); insert into hoja_fabricacion_pedidos (hoja_id, shopify_order_id, pedido_numero) values ('00000000-0000-4000-8000-0000000000aa', 'TEST-T9301', 'T9301'), ('00000000-0000-4000-8000-0000000000aa', 'gid://shopify/Order/1300', '1300')`)
const c = (await correr(leer('despachos_orden_de_prueba_borrar.sql')))[0]
chequeo('termina con la comprobación en 0 y 0', Number(c.pedidos_de_prueba_que_quedan) === 0 && Number(c.en_hojas_que_quedan) === 0, JSON.stringify(c))
chequeo('no queda ningún pedido de prueba y el pedido real sigue intacto (y en su hoja)', (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id like 'TEST-%'`))[0].n === 0 && (await q(`select count(*)::int n from ordenes_fabricacion where numero = '1300'`))[0].n === 1 && (await q(`select count(*)::int n from hoja_fabricacion_pedidos where pedido_numero = '1300'`))[0].n === 1)
await correr(leer('despachos_orden_de_prueba_borrar.sql'))
chequeo('ejecutarlo otra vez no hace daño; y se pueden volver a crear', (await correr(insertar)).length === 42)
await correr(leer('despachos_orden_de_prueba_borrar.sql'))
await correr(insertar)
const otros = leer('despachos_de_prueba_borrar.sql')
await correr(otros)
chequeo('el borrado de los T92 (otro juego de pruebas) NO toca estos T93', (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id like 'TEST-T93%'`))[0].n === 42)

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
