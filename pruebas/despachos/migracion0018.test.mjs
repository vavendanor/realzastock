/* Migración 0018 (despachos) con las migraciones reales en Postgres (PGlite) y un auth.uid() como el de Supabase.
   Correr desde la raíz:  node pruebas/despachos/migracion0018.test.mjs */
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
const archivos = readdirSync(DIR).filter((f) => f.endsWith('.sql') && !f.startsWith('0011')).sort()
for (const f of archivos) {
  let sql = readFileSync(`${DIR}/${f}`, 'utf8')
  if (f.startsWith('0014')) sql = sql.split('-- PARTE 2: programación cada 5 minutos')[0]
  await db.exec(sql)
}
const q = async (sql, args) => (await db.query(sql, args)).rows
const insertar = readFileSync(`${RAIZ}supabase/verificacion/pedidos_de_prueba_insertar.sql`, 'utf8')
await db.exec(insertar)

const ADMIN = '00000000-0000-0000-0000-00000000000a', BODEGA = '00000000-0000-0000-0000-00000000000b', VENDEDOR = '00000000-0000-0000-0000-00000000000c'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${ADMIN}', 'a@x.cl', '{}'), ('${BODEGA}', 'b@x.cl', '{}'), ('${VENDEDOR}', 'v@x.cl', '{}');
  update usuarios set rol = 'administrador' where id = '${ADMIN}'; update usuarios set rol = 'bodega' where id = '${BODEGA}'; update usuarios set rol = 'vendedor' where id = '${VENDEDOR}';`)

async function como(quien, fn) {
  if (quien === 'anon') await db.exec(`select set_config('request.jwt.claims', '', false); set role anon`)
  else await db.exec(`select set_config('request.jwt.claims', json_build_object('sub', '${quien}', 'role', 'authenticated')::text, false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const intentar = async (quien, sql, args) => { try { return { r: await como(quien, () => q(sql, args)) } } catch (e) { return { e } } }
const id = async (numero) => (await q(`select id from ordenes_fabricacion where numero = $1`, [numero]))[0].id
const fila = async (numero) => (await q(`select estado::text, despacho_programado::text as fecha, despachado_en, cancelado_en from ordenes_fabricacion where numero = $1`, [numero]))[0]
const hoy = (await q(`select (now() at time zone 'America/Santiago')::date::text d, ((now() at time zone 'America/Santiago')::date + 1)::text m, ((now() at time zone 'America/Santiago')::date - 1)::text a`))[0]
/* Deja los muebles de prueba en un estado conocido (como superusuario). */
const reponer = async () => {
  await db.exec(`update ordenes_fabricacion set cancelado_en = null where shopify_order_id like 'TEST-%'`)
  await db.exec(`update ordenes_fabricacion set estado = 'fabricado', listo = true, listo_origen = 'app', listo_en = now(), despacho_programado = null, despachado_en = null where numero in ('T9004', 'T9006')`)
  await db.exec(`update ordenes_fabricacion set estado = 'en_despacho', despacho_programado = null where numero = 'T9005'`)
  await db.exec(`update ordenes_fabricacion set estado = 'por_fabricar', listo = false, listo_origen = null, listo_en = null, despacho_programado = null where numero in ('T9001-1', 'T9001-2', 'T9002', 'T9003')`)
}
await reponer()
const A = await id('T9004'), B = await id('T9006'), DESP = await id('T9005'), PF = await id('T9002')

sec('La columna y el disparador')
const col = await q(`select data_type, is_nullable from information_schema.columns where table_name = 'ordenes_fabricacion' and column_name = 'despacho_programado'`)
chequeo('despacho_programado existe, es una fecha y admite vacío', col.length === 1 && col[0].data_type === 'date' && col[0].is_nullable === 'YES')
chequeo('ningún mueble tiene fecha al comienzo', (await q(`select count(*)::int n from ordenes_fabricacion where despacho_programado is not null`))[0].n === 0)

sec('programar_despacho')
let r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date) n`, [[A, B], hoy.m])
chequeo('el administrador programa 2 muebles fabricados para mañana', r.r?.[0].n === 2 && (await fila('T9004')).fecha === hoy.m && (await fila('T9006')).fecha === hoy.m, String(r.e?.message))
r = await intentar(BODEGA, `select programar_despacho($1::uuid[], $2::date) n`, [[A], hoy.d])
chequeo('bodega también puede, y hoy es una fecha válida (reprograma)', r.r?.[0].n === 1 && (await fila('T9004')).fecha === hoy.d, String(r.e?.message))
await reponer()
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date)`, [[A], hoy.a])
chequeo('una fecha de ayer se rechaza con un mensaje claro', /anterior a hoy/.test(r.e?.message ?? '') && (await fila('T9004')).fecha === null, String(r.e?.message))
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], null)`, [[A]])
chequeo('sin fecha se rechaza', /Indica la fecha/.test(r.e?.message ?? ''))
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date)`, [[A, PF], hoy.m])
chequeo('un mueble por fabricar en la lista: se rechaza TODO (todo o nada) y nombra al mueble', /T9002/.test(r.e?.message ?? '') && (await fila('T9004')).fecha === null, String(r.e?.message))
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date)`, [[DESP], hoy.m])
chequeo('un mueble que ya está en despacho no se programa', /T9005/.test(r.e?.message ?? ''))
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date)`, [['11111111-1111-4111-8111-111111111111'], hoy.m])
chequeo('un mueble inexistente se rechaza', /no existe/.test(r.e?.message ?? ''))
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date)`, [[], hoy.m])
chequeo('lista vacía: "Elige al menos un mueble"', /Elige al menos un mueble/.test(r.e?.message ?? ''))
await db.exec(`update ordenes_fabricacion set cancelado_en = now() where numero = 'T9006'`)
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date)`, [[B], hoy.m])
chequeo('un mueble cancelado no se programa', /T9006/.test(r.e?.message ?? ''))
await reponer()
r = await intentar(ADMIN, `select programar_despacho($1::uuid[], $2::date) n`, [[A, A, B], hoy.m])
chequeo('ids repetidos no molestan (cuenta cada mueble una vez)', r.r?.[0].n === 2)

sec('Disparador de coherencia')
await reponer()
await como(ADMIN, () => q(`select programar_despacho($1::uuid[], $2::date)`, [[A, B], hoy.m]))
await db.exec(`update ordenes_fabricacion set cancelado_en = now() where numero = 'T9006'`)
chequeo('si el pedido se cancela, el mueble pierde su fecha', (await fila('T9006')).fecha === null)
await db.exec(`update ordenes_fabricacion set cancelado_en = null where numero = 'T9006'`)
chequeo('...y al reactivarse no recupera una fecha que ya no existe', (await fila('T9006')).fecha === null && (await fila('T9004')).fecha === hoy.m)
await como(ADMIN, () => q(`select marcar_etapa($1, 'listo', false)`, [A]))
chequeo('si se desmarca LISTO (vuelve a por fabricar), pierde la fecha', (await fila('T9004')).estado === 'por_fabricar' && (await fila('T9004')).fecha === null)

sec('quitar_despacho_programado')
await reponer()
await como(ADMIN, () => q(`select programar_despacho($1::uuid[], $2::date)`, [[A, B], hoy.m]))
r = await intentar(BODEGA, `select quitar_despacho_programado($1::uuid[]) n`, [[A]])
chequeo('quitar la fecha de un mueble programado: 1', r.r?.[0].n === 1 && (await fila('T9004')).fecha === null && (await fila('T9006')).fecha === hoy.m, String(r.e?.message))
r = await intentar(ADMIN, `select quitar_despacho_programado($1::uuid[]) n`, [[A]])
chequeo('repetirlo no es un error (0 cambios)', r.r?.[0].n === 0)
await como(ADMIN, () => q(`select marcar_despachado($1::uuid[])`, [[B]]))
r = await intentar(ADMIN, `select quitar_despacho_programado($1::uuid[])`, [[B, A]])
chequeo('si alguno ya salió a despacho, se rechaza todo y se dice cuál', /T9006/.test(r.e?.message ?? ''))
r = await intentar(ADMIN, `select quitar_despacho_programado($1::uuid[])`, [[]])
chequeo('lista vacía se rechaza', /Elige al menos un mueble/.test(r.e?.message ?? ''))

sec('marcar_despachado')
await reponer()
await como(ADMIN, () => q(`select programar_despacho($1::uuid[], $2::date)`, [[A], hoy.m]))
r = await intentar(ADMIN, `select marcar_despachado($1::uuid[]) n`, [[A, B]])
const fa = await fila('T9004'), fb = await fila('T9006')
chequeo('pasa 2 muebles fabricados a "en despacho" de una vez y guarda cuándo salieron', r.r?.[0].n === 2 && fa.estado === 'en_despacho' && fb.estado === 'en_despacho' && fa.despachado_en !== null && fb.despachado_en !== null, String(r.e?.message))
chequeo('el que tenía fecha la conserva; el que no, queda con la de hoy', fa.fecha === hoy.m && fb.fecha === hoy.d, `${fa.fecha} ${fb.fecha}`)
r = await intentar(ADMIN, `select marcar_despachado($1::uuid[])`, [[A]])
chequeo('uno que ya está en despacho NO avanza a entregado: se rechaza', /T9004/.test(r.e?.message ?? '') && (await fila('T9004')).estado === 'en_despacho', String(r.e?.message))
await reponer()
r = await intentar(ADMIN, `select marcar_despachado($1::uuid[])`, [[A, PF]])
chequeo('si alguno no está fabricado, no despacha ninguno', /T9002/.test(r.e?.message ?? '') && (await fila('T9004')).estado === 'fabricado')
await db.exec(`update ordenes_fabricacion set cancelado_en = now() where numero = 'T9006'`)
r = await intentar(ADMIN, `select marcar_despachado($1::uuid[])`, [[B]])
chequeo('un mueble cancelado no se despacha', /T9006/.test(r.e?.message ?? ''))
await reponer()
chequeo('"pasar a en despacho" de cada pedido sigue igual (avanzar_estado_orden)', (await como(ADMIN, () => q(`select avanzar_estado_orden($1) a`, [A])))[0].a === 'en_despacho' && (await fila('T9004')).despachado_en !== null)

sec('Permisos: vendedor y anónimo')
await reponer()
for (const [quien, nombre] of [[VENDEDOR, 'vendedor'], ['anon', 'anónimo']]) {
  for (const [fn, sql, args] of [['programar_despacho', `select programar_despacho($1::uuid[], $2::date)`, [[A], hoy.m]], ['quitar_despacho_programado', `select quitar_despacho_programado($1::uuid[])`, [[A]]], ['marcar_despachado', `select marcar_despachado($1::uuid[])`, [[A]]]]) {
    const x = await intentar(quien, sql, args)
    chequeo(`${nombre} no puede llamar a ${fn}`, /No tienes permiso|permission denied/.test(x.e?.message ?? ''), String(x.e?.message ?? 'no falló'))
  }
  const v = await intentar(quien, `select count(*)::int n from ordenes_fabricacion where despacho_programado is not null or estado = 'fabricado'`, [])
  chequeo(`${nombre} no ve ningún mueble`, v.r?.[0].n === 0 || /permission denied/.test(v.e?.message ?? ''), JSON.stringify(v.r))
}
chequeo('nada cambió tras los intentos sin permiso', (await fila('T9004')).estado === 'fabricado' && (await fila('T9004')).fecha === null)

sec('La sincronización no pisa las fechas')
await como(ADMIN, () => q(`select programar_despacho($1::uuid[], $2::date)`, [[A], hoy.m]))
/* Un upsert como el de la Edge Function: solo las columnas que Shopify informa. */
await db.exec(`insert into ordenes_fabricacion (numero, pedido_numero, shopify_order_id, shopify_line_item_id, unidad, tipo, modelo, comuna, pedido_creado_en, origen_shopify)
  select numero, pedido_numero, shopify_order_id, shopify_line_item_id, unidad, tipo, 'MODELO ACTUALIZADO', 'Vitacura', pedido_creado_en, 'prueba' from ordenes_fabricacion where numero = 'T9004'
  on conflict (shopify_line_item_id, unidad) do update set modelo = excluded.modelo, comuna = excluded.comuna`)
chequeo('un upsert de la sincronización cambia lo de Shopify pero conserva la fecha programada', (await q(`select modelo, despacho_programado::text f from ordenes_fabricacion where numero = 'T9004'`))[0].f === hoy.m && (await q(`select modelo from ordenes_fabricacion where numero = 'T9004'`))[0].modelo === 'MODELO ACTUALIZADO')
await db.exec(`update ordenes_fabricacion set cancelado_en = null where numero = 'T9004'`)
chequeo('y reactivar un pedido (cancelado_en = null) tampoco la toca', (await fila('T9004')).fecha === hoy.m)

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
