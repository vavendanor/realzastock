import type { CellObject, SheetData } from 'write-excel-file/browser'
import type { OrdenFabricacion } from '../types'
import { ESTADO_ORDEN_LABEL, ORIGEN_LABEL } from './etiquetas'

/* Arma la hoja de Excel de "Exportar" a partir de las órdenes. No consulta la
   base de datos ni escribe el archivo: solo transforma datos, para poder
   probarla por separado.

   El formato es el de la planilla de octubre (las mismas 19 columnas, en el
   mismo orden), más Estado y Origen al final. Qué NO lleva, a propósito: el
   RUT, el teléfono, el correo ni la dirección. "Inf adicional" lleva la nota
   de producción (sin datos personales), nunca la nota original del pedido. */

export const COLUMNAS_PLANILLA = [
  'Nº',
  'Tipo',
  'Modelo',
  'Orientación',
  'CM',
  'Color',
  'Tela',
  'Región',
  'Comuna',
  'Patas',
  'Inf adicional',
  'B',
  'I',
  'A',
  'C',
  'LISTO',
  'Fecha pedido',
  'Cliente',
  'ID Shopify',
] as const

export const COLUMNAS_EXPORTACION = [...COLUMNAS_PLANILLA, 'Estado', 'Origen'] as const

const ANCHOS = [9, 11, 14, 12, 15, 14, 22, 16, 18, 17, 46, 4, 4, 4, 4, 7, 17, 24, 34, 13, 18]

/* ---------------- Región y comuna, como en la planilla ---------------- */

/* La base guarda el nombre oficial de la región; la planilla (que viene de
   Shopify) usa una forma corta en mayúsculas. Equivalencias:
   - Las 9 marcadas "visto" se tomaron de los valores reales de la planilla de
     octubre.
   - Las 7 marcadas "supuesto" no aparecen en octubre (no hubo pedidos): son la
     forma corta más probable, sin confirmar. */
export const REGION_COMO_EN_PLANILLA: Record<string, string> = {
  'Metropolitana de Santiago': 'METROPOLITANA', // visto
  "Libertador General Bernardo O'Higgins": "O'HIGGINS", // visto
  'Valparaíso': 'VALPARAÍSO', // visto
  'Biobío': 'BIOBÍO', // visto
  'Tarapacá': 'TARAPACÁ', // visto
  'La Araucanía': 'ARAUCANÍA', // visto
  'Coquimbo': 'COQUIMBO', // visto
  'Maule': 'MAULE', // visto
  'Antofagasta': 'ANTOFAGASTA', // visto
  'Arica y Parinacota': 'ARICA Y PARINACOTA', // supuesto
  'Atacama': 'ATACAMA', // supuesto
  'Ñuble': 'ÑUBLE', // supuesto
  'Los Ríos': 'LOS RÍOS', // supuesto
  'Los Lagos': 'LOS LAGOS', // supuesto
  'Aysén del General Carlos Ibáñez del Campo': 'AYSÉN', // supuesto
  'Magallanes y de la Antártica Chilena': 'MAGALLANES', // supuesto
}

export function regionComoEnPlanilla(region: string | null) {
  if (!region) return null
  return REGION_COMO_EN_PLANILLA[region] ?? region.toUpperCase()
}

/* La planilla escribe las comunas en mayúsculas ("ÑUÑOA", "MAIPÚ"). Los
   valores especiales ("RETIRO TIENDA", "NO SE PROPORCIONÓ DIRECCIÓN DE
   ENVÍO") ya están en mayúsculas. */
export function comunaComoEnPlanilla(comuna: string | null) {
  return comuna ? comuna.toUpperCase() : null
}

/* ---------------- Fecha y hora ---------------- */

const formatoChile = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/* Excel guarda fechas sin zona horaria: lo que se ve es lo que se escribe. Para
   que se vea la hora de Chile (y no la de UTC), se escribe un instante cuya
   hora en UTC es la hora que marcaba el reloj en Chile. */
export function horaChileComoUtc(iso: string) {
  const p: Record<string, number> = {}
  for (const parte of formatoChile.formatToParts(new Date(iso))) if (parte.type !== 'literal') p[parte.type] = Number(parte.value)
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute))
}

/* ---------------- Orden y construcción ---------------- */

function claveNumero(numero: string): [number, number] {
  const [pedido, unidad] = numero.split('-')
  return [Number(pedido) || 0, Number(unidad) || 0]
}

/* De la más antigua a la más reciente, como la planilla; dentro de un mismo
   instante, por número de pedido y unidad. */
export function ordenarParaExportar(ordenes: OrdenFabricacion[]) {
  return [...ordenes].sort((a, b) => {
    if (a.pedidoCreadoEn !== b.pedidoCreadoEn) return a.pedidoCreadoEn < b.pedidoCreadoEn ? -1 : 1
    const [pa, ua] = claveNumero(a.numero)
    const [pb, ub] = claveNumero(b.numero)
    return pa !== pb ? pa - pb : ua - ub
  })
}

const texto = (valor: string | null | undefined): CellObject | null => {
  const v = valor?.trim()
  return v ? { value: v, type: String } : null
}

const marca = (marcada: boolean): CellObject | null => (marcada ? { value: 'X', type: String, align: 'center' } : null)

export interface HojaPedidos {
  datos: SheetData
  columnas: { width: number }[]
}

/* `nombres`: nombre del cliente por id de orden (la columna Cliente). */
export function construirHoja(ordenes: OrdenFabricacion[], nombres: Map<string, string>): HojaPedidos {
  const encabezado: CellObject[] = COLUMNAS_EXPORTACION.map((titulo, i) => ({
    value: titulo,
    type: String,
    fontWeight: 'bold',
    backgroundColor: '#d9d9d9',
    align: i >= 11 && i <= 15 ? 'center' : 'left',
  }))

  const filas = ordenarParaExportar(ordenes).map((o) => [
    texto(o.numero), // texto: "1180-1" no se convierte en fecha ni en número
    texto(o.tipo),
    texto(o.modelo),
    texto(o.orientacion),
    texto(o.cm),
    texto(o.color),
    texto(o.tela),
    texto(regionComoEnPlanilla(o.region)),
    texto(comunaComoEnPlanilla(o.comuna)),
    texto(o.patas),
    { value: o.notasProduccion?.trim() || '', type: String, wrap: true, alignVertical: 'top' } as CellObject,
    marca(o.etapaB),
    marca(o.etapaI),
    marca(o.etapaA),
    marca(o.etapaC),
    marca(o.listo),
    { value: horaChileComoUtc(o.pedidoCreadoEn), type: Date, format: 'dd-mm-yyyy hh:mm' } as CellObject,
    texto(nombres.get(o.id)),
    texto(o.shopifyOrderId),
    texto(ESTADO_ORDEN_LABEL[o.estado]),
    texto(o.origen ? ORIGEN_LABEL[o.origen] : null),
  ])

  return {
    datos: [encabezado, ...filas] as SheetData,
    columnas: ANCHOS.map((width) => ({ width })),
  }
}

/* ---------------- Nombre del archivo ---------------- */

export interface FiltrosParaNombre {
  desde: string
  hasta: string
  estado: string
  comuna: string
  modelo: string
  tela: string
  origen: string
}

/* pedidos-realza_2026-10-01_a_2026-10-31.xlsx cuando hay fechas;
   pedidos-realza_2026-11-02.xlsx (día de hoy) cuando no. Si además hay otros
   filtros, termina en _filtrado. */
export function nombreArchivoExportacion(f: FiltrosParaNombre, hoy: string) {
  const fechas = f.desde || f.hasta ? `_${f.desde || 'inicio'}_a_${f.hasta || hoy}` : `_${hoy}`
  const otros = f.estado !== 'todos' || f.comuna || f.modelo || f.tela || f.origen !== 'todos'
  return `pedidos-realza${fechas}${otros ? '_filtrado' : ''}.xlsx`
}
