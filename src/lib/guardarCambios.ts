import type { OrdenFabricacion } from '../types'
import {
  aLote,
  clasificarProblemas,
  interpretarError,
  quitarClaves,
  type CambioDeLote,
  type Pendientes,
  type ProblemaConPendiente,
} from './cambiosPendientes'
import { guardarCambiosEtapas } from './ordenes'

/* Guarda los cambios pendientes en el servidor, todos juntos, y decide qué hacer
   con lo que el servidor responda. Sin React: se prueba por separado.

   El servidor es de todo o nada: si UN cambio no se puede aplicar, no aplica
   ninguno. Por eso, cuando responde con problemas:
     * Los que ya están como la persona quería (el valor actual es el pedido) se dan
       por guardados, sin avisar: se sacan de la lista y se reintenta con el resto.
       Con casillas de sí/no, todo "conflicto" es de este tipo.
     * Si queda algún problema real (el mueble ya está en despacho, el pedido fue
       cancelado, la orden ya no existe), NO se aplica nada y se devuelven esos
       problemas para que la persona decida. */

export const MAX_INTENTOS = 3 // el envío inicial y hasta 2 reintentos automáticos

export type Enviar = (lote: CambioDeLote[]) => Promise<OrdenFabricacion[]>

export type ResultadoGuardado =
  /* Todo quedó guardado. `guardados` es cuántos cambios aplicó este envío;
     `yaEstaban` cuántos ya estaban como se pedía (se dieron por hechos). */
  | { estado: 'ok'; guardados: number; yaEstaban: number; filas: OrdenFabricacion[] }
  /* No se aplicó nada: hay cambios que no se pueden guardar. `pendientes` es lo que
     sigue pendiente (ya sin los que se dieron por hechos). */
  | { estado: 'problemas'; pendientes: Pendientes; problemas: ProblemaConPendiente[]; yaEstaban: number }
  /* No se pudo guardar por otra causa (red, permisos, migración faltante...). */
  | { estado: 'error'; pendientes: Pendientes; mensaje: string; yaEstaban: number }

export async function guardarConReintentos(pendientes: Pendientes, enviar: Enviar = guardarCambiosEtapas): Promise<ResultadoGuardado> {
  let actual = pendientes
  let yaEstaban = 0

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const lote = aLote(actual)
    if (lote.length === 0) return { estado: 'ok', guardados: 0, yaEstaban, filas: [] }

    try {
      const filas = await enviar(lote)
      return { estado: 'ok', guardados: lote.length, yaEstaban, filas }
    } catch (e) {
      const respuesta = interpretarError(e)
      if (respuesta.tipo !== 'problemas') return { estado: 'error', pendientes: actual, mensaje: respuesta.mensaje, yaEstaban }

      const { resueltos, reales } = clasificarProblemas(actual, respuesta.problemas)
      if (resueltos.length > 0) {
        actual = quitarClaves(actual, resueltos)
        yaEstaban += resueltos.length
      }
      if (reales.length > 0) return { estado: 'problemas', pendientes: actual, problemas: reales, yaEstaban }
      /* Sin problemas reales: lo que chocaba ya estaba hecho. Si el servidor no
         marcó nada que podamos resolver, no hay forma de avanzar. */
      if (resueltos.length === 0) {
        return { estado: 'error', pendientes: actual, mensaje: 'El servidor rechazó los cambios sin indicar el motivo. Recarga la página e inténtalo de nuevo.', yaEstaban }
      }
    }
  }
  return { estado: 'error', pendientes: actual, mensaje: 'Los datos siguen cambiando mientras se guardan. Vuelve a intentarlo en un momento.', yaEstaban }
}
