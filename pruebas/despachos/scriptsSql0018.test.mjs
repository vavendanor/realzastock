/* Los SQL de supabase/verificacion para despachos, corridos sobre las migraciones reales (PGlite):
   los de pedidos de prueba (insertar y borrar) y los scripts de verificación por rol de la 0018.
   Correr desde la raíz:  node pruebas/despachos/scriptsSql0018.test.mjs */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../../', import.meta.url))
let ok = 0, fallos = 0
const chequeo = (n, c, d = '') => { c ? (ok++, console.log('  OK   ', n)) : (fallos++, console.log('  FALLA', n, d)) }
const sec = (t) => console.log(`\n== ${t}`)

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
const leer = (nombre) => readFileSync(`${RAIZ}supabase/verificacion/${nombre}`, 'utf8')
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', V = '00000000-0000-0000-0000-00000000000c'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${A}', 'a@x.cl', '{}'), ('${B}', 'b@x.cl', '{}'), ('${V}', 'v@x.cl', '{}');
  update usuarios set rol = 'administrador' where id = '${A}'; update usuarios set rol = 'bodega' where id = '${B}'; update usuarios set rol = 'vendedor' where id = '${V}';`)
/* Un pedido real que jamás debe tocarse. */
await db.exec(`insert into ordenes_fabricacion (numero, pedido_numero, shopify_order_id, shopify_line_item_id, unidad, tipo, modelo, pedido_creado_en, origen_shopify)
  values ('1300', '1300', 'gid://shopify/Order/1300', 'gid://shopify/LineItem/1', 1, 'SOFÁ', 'OSORNO', '2026-10-30T15:00:00Z', 'web')`)

sec('despachos_de_prueba_insertar.sql')
const insertar = leer('despachos_de_prueba_insertar.sql')
let r = await correr(insertar)
chequeo('termina mostrando los 12 muebles cargados', r.length === 12, String(r.length))
const filas = await q(`select * from ordenes_fabricacion where shopify_order_id like 'TEST-T92%' order by numero`)
chequeo('12 muebles en 11 pedidos (T9201 a T9211)', filas.length === 12 && new Set(filas.map((f) => f.pedido_numero)).size === 11)
const por = (e) => filas.filter((f) => f.estado === e).map((f) => f.numero).join()
chequeo('por fabricar: T9201-2 y T9211; en despacho: T9209; el resto fabricado', por('por_fabricar') === 'T9201-2,T9211' && por('en_despacho') === 'T9209' && filas.filter((f) => f.estado === 'fabricado').length === 9)
const f = (n) => filas.find((x) => x.numero === n)
chequeo('T9206 es retiro en tienda y T9207 no tiene dirección', f('T9206').comuna === 'RETIRO TIENDA' && /NO SE PROPORCION/.test(f('T9207').comuna), `${f('T9206').comuna} | ${f('T9207').comuna}`)
chequeo('las comunas normales quedan normalizadas (Providencia, Ñuñoa, Las Condes, Maipú, Vitacura)', ['T9201-1', 'T9203', 'T9204', 'T9210', 'T9209'].map((n) => f(n).comuna).join() === 'Providencia,Ñuñoa,Las Condes,Maipú,Vitacura', ['T9201-1', 'T9203', 'T9204', 'T9210', 'T9209'].map((n) => f(n).comuna).join())
chequeo('T9208 está cancelado; T9209 en despacho con su fecha de hoy; T9210 programado para mañana', f('T9208').cancelado_en !== null && f('T9209').despacho_programado !== null && f('T9210').despacho_programado !== null && f('T9209').despachado_en !== null)
chequeo('todos son de origen "prueba", con identificación TEST- y sin datos de clientes', filas.every((x) => x.origen_shopify === 'prueba' && x.shopify_order_id.startsWith('TEST-')) && (await q(`select count(*)::int n from ordenes_fabricacion_cliente c join ordenes_fabricacion o on o.id = c.orden_id where o.shopify_order_id like 'TEST-%'`))[0].n === 0)
await correr(insertar)
chequeo('ejecutarlo otra vez NO duplica nada', (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id like 'TEST-T92%'`))[0].n === 12)

sec('Scripts de verificación por rol (siempre terminan en error con el informe y revierten)')
const informe = async (script, reemplazos = []) => {
  let sql = leer(script)
  for (const [a, b] of reemplazos) sql = sql.replace(a, () => b)
  try { await db.exec(sql); return 'NO TERMINÓ EN ERROR' } catch (e) { return String(e.message) }
}
for (const [rol, reemplazos] of [['administrador', []], ['bodega', [["v_rol text := 'administrador'", "v_rol text := 'bodega'"]]]]) {
  const m = await informe('0018_verificar_admin_bodega.sql', reemplazos)
  chequeo(`administrador/bodega (${rol}): 0 fallas`, /Fallas: 0/.test(m) && !/FALLA/.test(m), m)
  chequeo(`(${rol}) el informe tiene las 8 comprobaciones`, (m.match(/OK {5}/g) ?? []).length === 8, m)
}
chequeo('tras los scripts nada cambió: T9201-1 sigue fabricado y sin fecha', (await q(`select estado::text e, despacho_programado d from ordenes_fabricacion where numero = 'T9201-1'`))[0].e === 'fabricado' && (await q(`select despacho_programado d from ordenes_fabricacion where numero = 'T9201-1'`))[0].d === null)
for (const [quien, reemplazos] of [['vendedor', []], ['anon', [["v_quien text := 'vendedor'", "v_quien text := 'anon'"]]]]) {
  const m = await informe('0018_verificar_sin_acceso.sql', reemplazos)
  chequeo(`sin acceso (${quien}): 0 fallas y las 5 comprobaciones OK`, /Fallas: 0/.test(m) && (m.match(/OK {5}/g) ?? []).length === 5, m)
}
const sinDatos = await (async () => {
  await db.exec(`delete from ordenes_fabricacion where shopify_order_id like 'TEST-T92%'`)
  return informe('0018_verificar_admin_bodega.sql')
})()
chequeo('sin datos de prueba, el script lo dice claramente en vez de dar un informe falso', /Faltan datos para probar/.test(sinDatos), sinDatos)

sec('despachos_de_prueba_borrar.sql')
await correr(insertar)
await db.exec(`insert into hojas_fabricacion (id, nombre) values ('00000000-0000-4000-8000-0000000000aa', 'Hoja real'); insert into hoja_fabricacion_pedidos (hoja_id, shopify_order_id, pedido_numero) values ('00000000-0000-4000-8000-0000000000aa', 'TEST-T9202', 'T9202'), ('00000000-0000-4000-8000-0000000000aa', 'gid://shopify/Order/1300', '1300')`)
const antesReal = (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id not like 'TEST-%'`))[0].n
const c = (await correr(leer('despachos_de_prueba_borrar.sql')))[0]
chequeo('termina con la comprobación en 0 y 0', Number(c.pedidos_de_prueba_que_quedan) === 0 && Number(c.en_hojas_que_quedan) === 0, JSON.stringify(c))
chequeo('no queda ningún pedido de prueba y el pedido real sigue intacto (y en su hoja)', (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id like 'TEST-%'`))[0].n === 0 && (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id not like 'TEST-%'`))[0].n === antesReal && (await q(`select count(*)::int n from hoja_fabricacion_pedidos where pedido_numero = '1300'`))[0].n === 1)
await correr(leer('despachos_de_prueba_borrar.sql'))
chequeo('ejecutarlo otra vez no hace daño; y se pueden volver a crear', (await q(`select count(*)::int n from ordenes_fabricacion where shopify_order_id not like 'TEST-%'`))[0].n === antesReal && (await correr(insertar)).length === 12)

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
