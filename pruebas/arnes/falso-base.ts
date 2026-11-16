/* Supabase falso SOLO para probar la pantalla de cambios sin guardar. Se borra al terminar.

   Sesión: localStorage['test-rol'] (administrador | bodega | vendedor).
   "Base de datos": las órdenes de octubre en memoria. Los cambios que se hacen se
   recuerdan en localStorage['test-srv'] para que sobrevivan a una recarga de la página.
   guardar_cambios_etapas aplica las MISMAS reglas que la función real de la migración
   0017 (comparación contra el valor esperado, todo o nada, detalle JSON de problemas).
   window.__srv sirve para simular que OTRA persona cambia algo mientras tanto. */
import datos from './datos.json'

type Fila = Record<string, unknown> & { id: string; numero: string }
const base = (datos as { ordenes: Fila[] }).ordenes.map((o) => ({ ...o, shopify_preparado: false, listo_origen: o.listo ? 'app' : null, plazo_desde: null })) as Fila[]
const cambiosGuardados: Record<string, Record<string, unknown>> = JSON.parse(localStorage.getItem('test-srv') ?? '{}')
const filas: Fila[] = base.map((f) => ({ ...f, ...(cambiosGuardados[f.id] ?? {}) }))
const guardarCambios = (id: string, campos: Record<string, unknown>) => {
  cambiosGuardados[id] = { ...(cambiosGuardados[id] ?? {}), ...campos }
  localStorage.setItem('test-srv', JSON.stringify(cambiosGuardados))
}
const porId = (id: string) => filas.find((f) => f.id === id)

;(window as unknown as Record<string, unknown>).__srv = {
  /* Otra persona cambia campos de una orden (por número). */
  otro(numero: string, campos: Record<string, unknown>) {
    const f = filas.find((x) => x.numero === numero)
    if (!f) throw new Error('no existe ' + numero)
    Object.assign(f, campos)
    guardarCambios(f.id, campos)
  },
  fila: (numero: string) => filas.find((x) => x.numero === numero) ?? null,
  numeros: (estado: string) => filas.filter((f) => f.estado === estado && !f.cancelado_en && !f.es_adicional).map((f) => f.numero),
  llamadas: [] as unknown[],
}
const llamadas = (window as unknown as { __srv: { llamadas: unknown[] } }).__srv.llamadas

const rol = () => localStorage.getItem('test-rol')
const sesion = () => (rol() ? { user: { id: `u-${rol()}`, email: `${rol()}@x.cl` }, access_token: 't' } : null)
const oyentes = new Set<(e: string, s: unknown) => void>()

const auth = {
  getSession: async () => ({ data: { session: sesion() } }),
  onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
    oyentes.add(cb)
    return { data: { subscription: { unsubscribe: () => oyentes.delete(cb) } } }
  },
  signOut: async () => {
    localStorage.removeItem('test-rol')
    oyentes.forEach((cb) => cb('SIGNED_OUT', null))
    return { error: null }
  },
  signInWithPassword: async ({ email }: { email: string }) => {
    localStorage.setItem('test-rol', email.split('@')[0])
    oyentes.forEach((cb) => cb('SIGNED_IN', sesion()))
    return { error: null }
  },
}

/* ---- Consultas ---- */
type Filtro = (f: Fila) => boolean
function consulta(tabla: string) {
  const filtros: Filtro[] = []
  let opciones: { head?: boolean } = {}
  let desde = 0
  let hasta = Infinity
  const orden: { col: string; asc: boolean }[] = []
  const valores = () => {
    if (tabla !== 'ordenes_fabricacion') return [] as Fila[]
    let r = filas.filter((f) => filtros.every((fn) => fn(f)))
    for (const o of [...orden].reverse()) r = [...r].sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -1 : String(a[o.col]) > String(b[o.col]) ? 1 : 0) * (o.asc ? 1 : -1))
    return r
  }
  const resultado = () => {
    const todo = valores()
    return opciones.head ? { data: null, count: todo.length, error: null } : { data: todo.slice(desde, desde + hasta), count: todo.length, error: null }
  }
  const unico = (puedeNo: boolean) => {
    if (tabla === 'usuarios') return { data: { id: `u-${rol()}`, rol: rol(), nombre: rol(), email: `${rol()}@x.cl` }, error: null }
    const v = valores()
    if (tabla === 'ordenes_fabricacion') return v[0] ? { data: v[0], error: null } : puedeNo ? { data: null, error: null } : { data: null, error: { message: 'sin filas' } }
    return puedeNo ? { data: null, error: null } : { data: null, error: { message: 'sin datos' } }
  }
  const q: unknown = new Proxy(function () {}, {
    get(_, prop: string) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, no: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, no)
      if (prop === 'maybeSingle') return () => Promise.resolve(unico(true))
      if (prop === 'single') return () => Promise.resolve(unico(false))
      return (...a: unknown[]) => {
        if (prop === 'select') opciones = (a[1] as { head?: boolean }) ?? {}
        else if (prop === 'eq') filtros.push((f) => f[a[0] as string] === a[1])
        else if (prop === 'neq') filtros.push((f) => f[a[0] as string] !== a[1])
        else if (prop === 'is') filtros.push((f) => (f[a[0] as string] ?? null) === a[1])
        else if (prop === 'gte') filtros.push((f) => String(f[a[0] as string]) >= String(a[1]))
        else if (prop === 'lte') filtros.push((f) => String(f[a[0] as string]) <= String(a[1]))
        else if (prop === 'in') filtros.push((f) => (a[1] as unknown[]).includes(f[a[0] as string]))
        else if (prop === 'order') orden.push({ col: a[0] as string, asc: (a[1] as { ascending: boolean })?.ascending !== false })
        else if (prop === 'limit') hasta = a[0] as number
        else if (prop === 'range') {
          desde = a[0] as number
          hasta = (a[1] as number) - (a[0] as number) + 1
        }
        return q
      }
    },
  })
  return q
}

/* ---- guardar_cambios_etapas: las mismas reglas que la función real ---- */
type Cambio = { orden_id: string; etapa: 'b' | 'i' | 'a' | 'c' | 'listo'; valor: boolean; esperado: boolean }
const campo = { b: 'etapa_b', i: 'etapa_i', a: 'etapa_a', c: 'etapa_c', listo: 'listo' } as const
function guardarLote(cambios: Cambio[]) {
  llamadas.push(JSON.parse(JSON.stringify(cambios)))
  const efectivos = cambios.filter((c) => c.valor !== c.esperado)
  const problemas = efectivos
    .map((c) => {
      const f = porId(c.orden_id)
      const actual = f ? (f[campo[c.etapa]] as boolean) : null
      const motivo = !f ? 'no_existe' : f.cancelado_en ? 'cancelada' : ['en_despacho', 'entregado'].includes(f.estado as string) ? 'bloqueada' : actual !== c.esperado ? 'conflicto' : null
      return motivo ? { orden_id: c.orden_id, numero: f?.numero ?? null, etapa: c.etapa, motivo, actual } : null
    })
    .filter(Boolean)
  if (problemas.length > 0) {
    return { data: null, error: { message: 'Hay cambios que no se pueden guardar: no se aplicó ninguno.', code: 'P0001', details: JSON.stringify(problemas) } }
  }
  const tocadas = new Map<string, Fila>()
  for (const c of efectivos) {
    const f = porId(c.orden_id)!
    f[campo[c.etapa]] = c.valor
    const extra: Record<string, unknown> = { [campo[c.etapa]]: c.valor }
    if (c.etapa === 'listo') {
      Object.assign(f, c.valor ? { estado: 'fabricado', listo_origen: 'app', listo_en: new Date().toISOString() } : { estado: 'por_fabricar', listo_origen: null, listo_en: null })
      Object.assign(extra, { estado: f.estado, listo_origen: f.listo_origen, listo_en: f.listo_en })
    }
    guardarCambios(f.id, extra)
    tocadas.set(f.id, f)
  }
  return { data: [...tocadas.values()].sort((a, b) => a.numero.localeCompare(b.numero, 'es', { numeric: true })), error: null }
}

export const supabase = {
  auth,
  from: (t: string) => consulta(t),
  rpc: async (nombre: string, args: { p_cambios?: Cambio[]; p_orden_id?: string }) => {
    if (nombre === 'guardar_cambios_etapas') return guardarLote(args.p_cambios ?? [])
    if (nombre === 'avanzar_estado_orden') {
      const f = porId(args.p_orden_id ?? '')
      if (!f) return { data: null, error: { message: 'no existe' } }
      const siguiente = f.estado === 'fabricado' ? 'en_despacho' : f.estado === 'en_despacho' ? 'entregado' : null
      if (!siguiente) return { data: null, error: { message: 'no avanza' } }
      f.estado = siguiente
      guardarCambios(f.id, { estado: siguiente })
      return { data: siguiente, error: null }
    }
    return { data: null, error: null }
  },
  functions: { invoke: async () => ({ data: null, error: null }) },
}

