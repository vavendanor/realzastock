/* Arma (o desarma) el banco de pruebas temporal dentro del proyecto: un Supabase falso con los pedidos
   de pruebas/arnes/datos.json (no se sube a Git), hojas de fabricación y sus funciones.
   Uso, desde la raíz:  node pruebas/arnes/armar.mjs [desarmar] */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const AQUI = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]$/, '')
const RAIZ = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '')

if (process.argv[2] === 'desarmar') {
  if (existsSync(`${RAIZ}/preview-tmp`)) {
    for (const f of readdirSync(`${RAIZ}/preview-tmp`)) rmSync(`${RAIZ}/preview-tmp/${f}`, { force: true })
    try { rmSync(`${RAIZ}/preview-tmp`, { recursive: true, force: true }) } catch { /* OneDrive puede retenerla vacía */ }
  }
  rmSync(`${RAIZ}/vite.preview-tmp.config.ts`, { force: true })
  console.log('desarmado')
  process.exit(0)
}

let s = readFileSync(`${AQUI}/falso-base.ts`, 'utf8')
const rep = (a, b) => { if (!s.includes(a)) throw new Error('no encontrado: ' + a.slice(0, 60)); s = s.replace(a, () => b) }

rep(`    if (tabla !== 'ordenes_fabricacion') return [] as Fila[]
    let r = filas.filter((f) => filtros.every((fn) => fn(f)))`, `    let r = fuente(tabla).filter((f) => filtros.every((fn) => fn(f)))`)
rep(`    if (tabla === 'ordenes_fabricacion') return v[0] ?`, `    if (tabla !== 'usuarios') return v[0] ?`)

rep(`/* ---- Consultas ---- */`, `/* ---- Hojas de fabricación (se recuerdan en localStorage para sobrevivir a una recarga) ---- */
const FERIADOS = ['2026-10-12', '2026-10-31', '2026-11-01']
const leer = <T,>(k: string): T[] => JSON.parse(localStorage.getItem(k) ?? '[]')
let hojas: Fila[] = leer('test-hojas')
let hojaPedidos: Fila[] = leer('test-hoja-pedidos')
const persistirHojas = () => {
  localStorage.setItem('test-hojas', JSON.stringify(hojas))
  localStorage.setItem('test-hoja-pedidos', JSON.stringify(hojaPedidos))
}
const esFabricable = (f: Fila) => !f.es_adicional || f.tipo === 'COJÍN'
const piezasDeHojas = () =>
  hojaPedidos.flatMap((hp) => filas.filter((f) => f.pedido_numero === hp.pedido_numero).map((f) => ({ ...f, hoja_id: hp.hoja_id, es_pieza_fabricable: esFabricable(f) }))) as Fila[]
function fuente(tabla: string): Fila[] {
  if (tabla === 'ordenes_fabricacion') return filas
  if (tabla === 'feriados_chile') return FERIADOS.map((fecha) => ({ id: fecha, numero: fecha, fecha }))
  if (tabla === 'hojas_fabricacion') return hojas
  if (tabla === 'hoja_fabricacion_pedidos') return hojaPedidos.map((h) => ({ ...h, id: h.hoja_id + h.pedido_numero, numero: h.pedido_numero }))
  if (tabla === 'hoja_fabricacion_piezas') return piezasDeHojas()
  return []
}
const srvGlobal = (window as unknown as { __srv: Record<string, unknown> }).__srv
srvGlobal.hojas = () => hojas.map((h) => ({ ...h, pedidos: hojaPedidos.filter((p) => p.hoja_id === h.id).map((p) => p.pedido_numero) }))
srvGlobal.llamadasHojas = [] as unknown[]
const bitacora = (op: string, datos: unknown) => (srvGlobal.llamadasHojas as unknown[]).push({ op, ...(datos as object) })
const falla = (message: string) => ({ data: null, error: { message } })
const tienePermiso = () => rol() === 'administrador' || rol() === 'bodega'
const hoyChile = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())
const existePedido = (p: string) => filas.some((f) => f.pedido_numero === p && !f.cancelado_en)

function funcionHoja(nombre: string, a: Record<string, unknown>) {
  bitacora(nombre, a)
  if (!tienePermiso()) return falla('No tienes permiso para modificar hojas de fabricación.')
  const hoja = hojas.find((h) => h.id === a.p_hoja_id)
  switch (nombre) {
    case 'crear_hoja_fabricacion': {
      const n = String(a.p_nombre ?? '').trim()
      const pedidos = (a.p_pedidos as string[]) ?? []
      if (n.length < 1 || n.length > 80) return falla('El nombre de la hoja debe tener entre 1 y 80 caracteres.')
      if (pedidos.length === 0) return falla('Elige al menos un pedido.')
      if (pedidos.length > 300) return falla('Una hoja admite hasta 300 pedidos.')
      for (const p of pedidos) if (!existePedido(p)) return falla(\`No existe el pedido \${p} (o está cancelado). No se creó la hoja.\`)
      const id = \`hoja-\${hojas.length + 1}-\${Date.now()}\`
      hojas.push({ id, numero: id, nombre: n, creada_en: new Date().toISOString() })
      for (const p of new Set(pedidos)) hojaPedidos.push({ id: id + p, numero: p, hoja_id: id, pedido_numero: p, shopify_order_id: String(filas.find((f) => f.pedido_numero === p)!.shopify_order_id) })
      persistirHojas()
      return { data: id, error: null }
    }
    case 'renombrar_hoja_fabricacion': {
      const n = String(a.p_nombre ?? '').trim()
      if (n.length < 1 || n.length > 80) return falla('El nombre de la hoja debe tener entre 1 y 80 caracteres.')
      if (!hoja) return falla('La hoja indicada no existe.')
      hoja.nombre = n
      persistirHojas()
      return { data: null, error: null }
    }
    case 'agregar_pedidos_a_hoja': {
      if (!hoja) return falla('La hoja indicada no existe.')
      const pedidos = (a.p_pedidos as string[]) ?? []
      for (const p of pedidos) if (!existePedido(p)) return falla(\`No existe el pedido \${p} (o está cancelado). No se agregó ninguno.\`)
      const nuevos = [...new Set(pedidos)].filter((p) => !hojaPedidos.some((h) => h.hoja_id === hoja.id && h.pedido_numero === p))
      if (hojaPedidos.filter((h) => h.hoja_id === hoja.id).length + nuevos.length > 300) return falla('Una hoja admite como máximo 300 pedidos.')
      for (const p of nuevos) hojaPedidos.push({ id: hoja.id + p, numero: p, hoja_id: hoja.id, pedido_numero: p, shopify_order_id: String(filas.find((f) => f.pedido_numero === p)!.shopify_order_id) })
      persistirHojas()
      return { data: nuevos.length, error: null }
    }
    case 'quitar_pedido_de_hoja': {
      const antes = hojaPedidos.length
      hojaPedidos = hojaPedidos.filter((h) => !(h.hoja_id === a.p_hoja_id && h.pedido_numero === String(a.p_pedido_numero).trim()))
      persistirHojas()
      return { data: antes - hojaPedidos.length, error: null }
    }
    case 'eliminar_hoja_fabricacion': {
      const antes = hojas.length
      hojas = hojas.filter((h) => h.id !== a.p_hoja_id)
      hojaPedidos = hojaPedidos.filter((h) => h.hoja_id !== a.p_hoja_id)
      persistirHojas()
      return { data: antes - hojas.length, error: null }
    }
    default:
      return falla('función desconocida ' + nombre)
  }
}

function fijarInicio(a: Record<string, unknown>) {
  bitacora('fijar_inicio_plazo', a)
  if (!tienePermiso()) return falla('No tienes permiso para modificar órdenes de fabricación.')
  const pedido = String(a.p_pedido_numero ?? '').trim()
  const activas = filas.filter((f) => f.pedido_numero === pedido && !f.cancelado_en)
  if (activas.length === 0) return falla(\`No hay órdenes activas del pedido \${pedido}.\`)
  const desde = activas.map((f) => String(f.fecha_pedido)).sort()[0]
  const fecha = (a.p_fecha as string | null) ?? null
  if (fecha !== null && fecha < desde) return falla(\`El inicio del plazo no puede ser anterior a la fecha del pedido (\${desde.split('-').reverse().join('-')}).\`)
  if (fecha !== null && fecha > hoyChile()) return falla('El inicio del plazo no puede ser una fecha futura.')
  for (const f of activas) {
    f.plazo_desde = fecha === f.fecha_pedido ? null : fecha
    guardarCambios(f.id, { plazo_desde: f.plazo_desde })
  }
  return { data: activas.length, error: null }
}

/* ---- Consultas ---- */`)

rep(`    if (nombre === 'avanzar_estado_orden') {`, `    if (['crear_hoja_fabricacion', 'renombrar_hoja_fabricacion', 'agregar_pedidos_a_hoja', 'quitar_pedido_de_hoja', 'eliminar_hoja_fabricacion'].includes(nombre)) return funcionHoja(nombre, args as unknown as Record<string, unknown>)
    if (nombre === 'fijar_inicio_plazo') return fijarInicio(args as unknown as Record<string, unknown>)
    if (nombre === 'avanzar_estado_orden') {`)

mkdirSync(`${RAIZ}/preview-tmp`, { recursive: true })
writeFileSync(`${RAIZ}/preview-tmp/supabaseFalso.ts`, s)
copyFileSync(`${AQUI}/datos.json`, `${RAIZ}/preview-tmp/datos.json`)
writeFileSync(`${RAIZ}/vite.preview-tmp.config.ts`, `import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: [{ find: /^.*\\/supabaseClient$/, replacement: path.resolve('preview-tmp/supabaseFalso.ts') }] },
})
`)
console.log('armado')
