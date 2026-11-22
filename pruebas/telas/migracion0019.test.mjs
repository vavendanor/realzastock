/* Migración 0019 (inventario de telas) con las migraciones reales en Postgres (PGlite).
   Correr desde la raíz:  node pruebas/telas/migracion0019.test.mjs */
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
const ADMIN = '00000000-0000-0000-0000-00000000000a', BODEGA = '00000000-0000-0000-0000-00000000000b', VENDEDOR = '00000000-0000-0000-0000-00000000000c'
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values ('${ADMIN}', 'a@x.cl', '{}'), ('${BODEGA}', 'b@x.cl', '{}'), ('${VENDEDOR}', 'v@x.cl', '{}');
  update usuarios set rol = 'administrador' where id = '${ADMIN}'; update usuarios set rol = 'bodega' where id = '${BODEGA}'; update usuarios set rol = 'vendedor' where id = '${VENDEDOR}';`)
async function como(quien, fn) {
  if (quien === 'anon') await db.exec(`select set_config('request.jwt.claims', '', false); set role anon`)
  else await db.exec(`select set_config('request.jwt.claims', json_build_object('sub', '${quien}', 'role', 'authenticated')::text, false); set role authenticated`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false)`) }
}
const intentar = async (quien, sql, args) => { try { return { r: await como(quien, () => q(sql, args)) } } catch (e) { return { e } } }

sec('Datos iniciales')
const filas = await q(`select nombre, metros::float m, stock_minimo::float s from telas order by nombre`)
chequeo('hay exactamente 4 telas: Cuero, Lino, Semicuero y Tela hidrorepelente', JSON.stringify(filas.map((f) => f.nombre)) === JSON.stringify(['Cuero', 'Lino', 'Semicuero', 'Tela hidrorepelente']), JSON.stringify(filas))
chequeo('cada una con 100 metros y mínimo 30', filas.every((f) => f.m === 100 && f.s === 30))
const sql0019 = readFileSync(`${DIR}/0019_inventario_telas.sql`, 'utf8')
await db.exec(`update telas set metros = 55 where nombre = 'Lino'`)
await db.exec(sql0019.slice(sql0019.indexOf('insert into public.telas'), sql0019.indexOf('-- 3)')))
chequeo('volver a correr los datos iniciales no pisa lo ya ajustado', (await q(`select metros::float m from telas where nombre = 'Lino'`))[0].m === 55 && (await q(`select count(*)::int n from telas`))[0].n === 4)
await db.exec(`update telas set metros = 100 where nombre = 'Lino'`)
const sinComentarios = sql0019.replace(/--.*$/gm, '')
chequeo('la migración solo crea la tabla telas y la función ajustar_tela (no altera tablas existentes)', !/alter table (?!public\.telas)/i.test(sinComentarios) && !/\bdrop\b/i.test(sinComentarios) && !/\bdelete from\b/i.test(sinComentarios))

sec('Lectura por rol')
const lectura = (quien) => intentar(quien, `select count(*)::int n from telas`, [])
chequeo('el administrador ve las 4 telas', (await lectura(ADMIN)).r?.[0].n === 4)
for (const [quien, nombre] of [[BODEGA, 'bodega'], [VENDEDOR, 'vendedor'], ['anon', 'anónimo']]) {
  const x = await lectura(quien)
  chequeo(`${nombre} no ve ninguna tela`, x.r?.[0].n === 0 || /permission denied/.test(x.e?.message ?? ''), JSON.stringify(x.r ?? x.e?.message))
}

sec('ajustar_tela')
const lino = (await q(`select id from telas where nombre = 'Lino'`))[0].id
let r = await intentar(ADMIN, `select ajustar_tela($1, 72.5, 25)`, [lino])
const t = (await q(`select metros::float m, stock_minimo::float s from telas where nombre = 'Lino'`))[0]
chequeo('el administrador cambia la cantidad (72,5 m) y el mínimo (25 m)', !r.e && t.m === 72.5 && t.s === 25, r.e?.message)
for (const [m, s, texto] of [[-1, 30, 'metros negativos'], [10, -5, 'mínimo negativo'], [null, 30, 'metros vacíos']]) {
  r = await intentar(ADMIN, `select ajustar_tela($1, $2, $3)`, [lino, m, s])
  chequeo(`rechaza ${texto}`, /0 o más/.test(r.e?.message ?? ''), r.e?.message)
}
r = await intentar(ADMIN, `select ajustar_tela($1, 10, 10)`, ['00000000-0000-0000-0000-000000000001'])
chequeo('rechaza una tela que no existe', /no existe/.test(r.e?.message ?? ''), r.e?.message)
chequeo('lo rechazado no cambió nada', (await q(`select metros::float m from telas where nombre = 'Lino'`))[0].m === 72.5)
for (const [quien, nombre] of [[BODEGA, 'bodega'], [VENDEDOR, 'vendedor'], ['anon', 'anónimo']]) {
  const x = await intentar(quien, `select ajustar_tela($1, 1, 1)`, [lino])
  chequeo(`${nombre} no puede ajustar una tela`, /Solo el administrador|permission denied/.test(x.e?.message ?? ''), x.e?.message)
}
chequeo('nada cambió tras los intentos sin permiso', (await q(`select metros::float m from telas where nombre = 'Lino'`))[0].m === 72.5)

sec('Escritura directa: nadie')
for (const [quien, nombre] of [[ADMIN, 'administrador'], [BODEGA, 'bodega'], ['anon', 'anónimo']]) {
  for (const [que, sql] of [['actualizar', `update telas set metros = 1`], ['borrar', `delete from telas`], ['agregar una tela', `insert into telas (nombre) values ('Otra')`]]) {
    const x = await intentar(quien, sql, [])
    chequeo(`${nombre} no puede ${que} directo en la tabla`, /permission denied/.test(x.e?.message ?? ''), x.e?.message ?? 'no falló')
  }
}
chequeo('siguen las 4 telas', (await q(`select count(*)::int n from telas`))[0].n === 4)

sec('El script de verificación de supabase/verificacion')
const script = readFileSync(`${RAIZ}supabase/verificacion/0019_verificar_telas.sql`, 'utf8')
for (const quien of ['administrador', 'bodega', 'vendedor', 'anon']) {
  let msg = ''
  try { await db.exec(script.replace("v_quien text := 'administrador'", `v_quien text := '${quien}'`)) } catch (e) { msg = e.message }
  chequeo(`como ${quien}: el informe sale con 0 fallas`, /Verificación 0019/.test(msg) && /\b0 fallas/.test(msg) && !/FALLA/.test(msg), msg.slice(0, 400))
}
chequeo('el script no deja cambios (Lino sigue en 72,5)', (await q(`select metros::float m from telas where nombre = 'Lino'`))[0].m === 72.5)

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
