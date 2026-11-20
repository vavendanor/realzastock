/* Despachos (migración 0018) en el Supabase falso: las mismas reglas y mensajes que las funciones reales.
   Este texto lo inserta armar.mjs en preview-tmp/supabaseFalso.ts; no se compila por separado. */
function funcionDespacho(nombre: string, a: Record<string, unknown>) {
  bitacora(nombre, a)
  if (!tienePermiso()) return falla('No tienes permiso para modificar despachos.')
  const ids = [...new Set(((a.p_orden_ids as string[]) ?? []).filter(Boolean))]
  if (ids.length === 0) return falla('Elige al menos un mueble.')
  const muebles = ids.map((id) => porId(id))
  if (muebles.some((m) => !m)) return falla('Alguno de los muebles indicados no existe.')
  const lista = muebles as Fila[]
  const nombres = (fs: Fila[]) => fs.map((f) => f.numero).sort((x, y) => x.localeCompare(y, 'es', { numeric: true })).join(', ')
  const hoy = hoyChile()
  if (nombre === 'programar_despacho') {
    const fecha = a.p_fecha as string | null
    if (!fecha) return falla('Indica la fecha del despacho.')
    if (fecha < hoy) return falla(`La fecha del despacho no puede ser anterior a hoy (${hoy.split('-').reverse().join('-')}).`)
    const malos = lista.filter((f) => f.cancelado_en || f.estado !== 'fabricado')
    if (malos.length) return falla(`Solo se programan muebles fabricados y no cancelados. No se pudo con: ${nombres(malos)}. No se programó ninguno.`)
    for (const f of lista) {
      f.despacho_programado = fecha
      guardarCambios(f.id, { despacho_programado: fecha })
    }
    return { data: lista.length, error: null }
  }
  if (nombre === 'quitar_despacho_programado') {
    const salieron = lista.filter((f) => ['en_despacho', 'entregado'].includes(f.estado as string))
    if (salieron.length) return falla(`Ya salieron a despacho y no se les puede quitar la fecha: ${nombres(salieron)}. No se cambió ninguno.`)
    const con = lista.filter((f) => f.despacho_programado)
    for (const f of con) {
      f.despacho_programado = null
      guardarCambios(f.id, { despacho_programado: null })
    }
    return { data: con.length, error: null }
  }
  const malos = lista.filter((f) => f.cancelado_en || f.estado !== 'fabricado')
  if (malos.length) return falla(`Solo se despachan muebles fabricados y no cancelados. No se pudo con: ${nombres(malos)}. No se despachó ninguno.`)
  for (const f of lista) {
    const campos = { estado: 'en_despacho', despachado_en: new Date().toISOString(), despacho_programado: f.despacho_programado ?? hoy }
    Object.assign(f, campos)
    guardarCambios(f.id, campos)
  }
  return { data: lista.length, error: null }
}
