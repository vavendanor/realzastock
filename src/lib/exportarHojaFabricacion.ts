import type { OrdenFabricacion } from '../types'
import { construirHojaExcelFabricacion } from './hojaFabricacion'

/* Descarga la hoja de fabricación como Excel. La librería que escribe el .xlsx
   se carga recién aquí (import dinámico), como en exportarPedidos.ts, para no
   pesar en el arranque de la app. */
export async function exportarHojaFabricacionAExcel(ordenes: OrdenFabricacion[], archivo: string): Promise<{ filas: number }> {
  const { datos, columnas } = construirHojaExcelFabricacion(ordenes)
  const filas = datos.length - 1
  if (filas <= 0) throw new Error('No hay nada que exportar.')

  const { default: escribirExcel } = await import('write-excel-file/browser')
  await escribirExcel(datos, { sheet: 'Hoja de fabricación', columns: columnas, stickyRowsCount: 1 }).toFile(archivo)
  return { filas }
}
