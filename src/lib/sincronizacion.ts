import { supabase } from './supabaseClient'

/* Estado de la sincronización con Shopify (tabla sync_shopify, una sola fila).
   Solo el administrador puede leerla (política sync_shopify_select): para
   cualquier otro rol la consulta vuelve vacía. */
export interface EstadoSincronizacion {
  ultimaSincronizacion: string | null
  ultimoIntento: string | null
  ultimoError: string | null
  enCursoDesde: string | null
  ordenesUltimaCorrida: number | null
}

/* Una marca de "en curso" más vieja que esto se considera abandonada (igual
   que reservar_sync_shopify en la base de datos). */
export const MINUTOS_MARCA_ABANDONADA = 10

export async function leerEstadoSincronizacion(): Promise<EstadoSincronizacion | null> {
  const { data, error } = await supabase
    .from('sync_shopify')
    .select('ultima_sincronizacion, ultimo_intento, ultimo_error, en_curso_desde, ordenes_ultima_corrida')
    .eq('id', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    ultimaSincronizacion: data.ultima_sincronizacion,
    ultimoIntento: data.ultimo_intento,
    ultimoError: data.ultimo_error?.trim() ? data.ultimo_error : null,
    enCursoDesde: data.en_curso_desde,
    ordenesUltimaCorrida: data.ordenes_ultima_corrida,
  }
}

/* "hace un momento", "hace 5 min", "hace 3 h", "hace 2 días". */
export function haceCuanto(desde: string | null, ahora: Date = new Date()): string {
  if (!desde) return 'nunca'
  const minutos = Math.floor((ahora.getTime() - new Date(desde).getTime()) / 60000)
  if (minutos < 1) return 'hace un momento'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/* ¿Hay una sincronización corriendo ahora mismo? */
export function sincronizacionEnCurso(estado: EstadoSincronizacion | null, ahora: Date = new Date()): boolean {
  if (!estado?.enCursoDesde) return false
  const minutos = (ahora.getTime() - new Date(estado.enCursoDesde).getTime()) / 60000
  return minutos < MINUTOS_MARCA_ABANDONADA
}

export interface ResultadoSincronizacion {
  /* Resumen corto para mostrar al administrador. */
  mensaje: string
  /* true si la corrida terminó con errores (la función responde 502). */
  conErrores: boolean
}

interface CuerpoFuncion {
  ok?: boolean
  parcial?: boolean
  enCurso?: boolean
  mensaje?: string
  error?: string
  errores?: string[]
  pedidos_leidos?: number
  ordenes?: { nuevas: number; actualizadas: number; canceladas: number }
}

/* Lanza la sincronización normal (incremental, igual que la del cron) con la
   sesión del administrador. La Edge Function verifica ella misma el rol: esta
   función no lo valida. Lanza un Error con un mensaje claro si no se pudo. */
export async function sincronizarAhora(): Promise<ResultadoSincronizacion> {
  const { data, error } = await supabase.functions.invoke('sincronizar-shopify', { body: {} })

  let cuerpo: CuerpoFuncion | null = (data as CuerpoFuncion | null) ?? null
  if (error) {
    /* Con un código de error HTTP, el SDK envuelve la respuesta: el mensaje
       real queda en el cuerpo (ver crearUsuario en usuarios.ts). Un 409 (ya
       hay una en marcha) y un 502 (falló la corrida) traen el detalle ahí. */
    const contexto = (error as { context?: Response }).context
    if (contexto) {
      try {
        cuerpo = (await contexto.json()) as CuerpoFuncion
      } catch {
        // El cuerpo no era JSON: se cae al mensaje genérico del SDK.
      }
    }
    if (!cuerpo) throw new Error(error.message)
  }

  if (!cuerpo) throw new Error('La función no devolvió respuesta.')
  if (cuerpo.enCurso) return { mensaje: 'Ya hay una sincronización en marcha. Espera un momento y vuelve a mirar.', conErrores: false }
  if (cuerpo.error) throw new Error(cuerpo.error)
  if (cuerpo.ok === false) {
    const detalle = cuerpo.errores?.length ? cuerpo.errores.slice(0, 3).join(' · ') : 'sin detalle'
    return { mensaje: `La sincronización terminó con errores: ${detalle}`, conErrores: true }
  }

  const o = cuerpo.ordenes
  const leidos = cuerpo.pedidos_leidos ?? 0
  if (!o || (o.nuevas === 0 && o.actualizadas === 0 && o.canceladas === 0)) {
    return { mensaje: `Sincronizado. ${leidos} pedido(s) revisado(s), sin cambios.`, conErrores: false }
  }
  const partes = [
    o.nuevas ? `${o.nuevas} nueva(s)` : null,
    o.actualizadas ? `${o.actualizadas} actualizada(s)` : null,
    o.canceladas ? `${o.canceladas} cancelada(s)` : null,
  ].filter(Boolean)
  return { mensaje: `Sincronizado. ${leidos} pedido(s) leído(s): ${partes.join(', ')}.`, conErrores: false }
}
