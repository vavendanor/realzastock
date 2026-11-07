import { crearCalendario, type Calendario } from './diasHabiles'
import { supabase } from './supabaseClient'

/* Lee de la base el calendario de feriados (tabla feriados_chile). Es una
   lista corta (unas 17 filas por año), así que se trae completa. Solo la ven
   quienes trabajan con producción (administrador y bodega). */
export async function leerCalendario(): Promise<Calendario> {
  const { data, error } = await supabase.from('feriados_chile').select('fecha').order('fecha', { ascending: true })
  if (error) throw new Error(error.message)
  return crearCalendario(((data ?? []) as { fecha: string }[]).map((f) => f.fecha))
}
