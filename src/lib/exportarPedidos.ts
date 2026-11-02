import type { OrdenFabricacion } from '../types'
import { construirHoja, nombreArchivoExportacion } from './hojaPedidos'
import { fechaLocal, listarOrdenesParaExportar, obtenerNombresClientes, type FiltrosOrdenes } from './ordenes'

export interface ResultadoExportacion {
  archivo: string
  filas: number
}

/* Descarga un Excel con las órdenes que coinciden con los filtros de la
   pantalla. La librería que escribe el .xlsx se carga recién aquí (import
   dinámico), para no pesar en el arranque de la app. */
export async function exportarPedidosAExcel(filtros: FiltrosOrdenes): Promise<ResultadoExportacion> {
  const ordenes: OrdenFabricacion[] = await listarOrdenesParaExportar(filtros)
  if (ordenes.length === 0) throw new Error('No hay órdenes con estos filtros: no hay nada que exportar.')

  const nombres = await obtenerNombresClientes(ordenes.map((o) => o.id))
  const { datos, columnas } = construirHoja(ordenes, nombres)
  const archivo = nombreArchivoExportacion(filtros, fechaLocal(new Date()))

  const { default: escribirExcel } = await import('write-excel-file/browser')
  await escribirExcel(datos, { sheet: 'Pedidos', columns: columnas, stickyRowsCount: 1 }).toFile(archivo)

  return { archivo, filas: ordenes.length }
}
