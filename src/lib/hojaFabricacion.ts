import type { CellObject, SheetData } from 'write-excel-file/browser'
import type { OrdenFabricacion } from '../types'
import { faltaColorTela } from './avisosOrden'
import { ordenarParaExportar } from './hojaPedidos'
import { formatearFechaPedido } from './ordenes'

/* Hoja de fabricación: la lista que usa el taller para fabricar. Este archivo
   solo ordena y transforma datos (no consulta la base ni dibuja nada), para
   poder probarlo por separado. La pantalla imprimible está en
   components/HojaFabricacion.tsx.

   NUNCA lleva datos personales: ni nombre, ni teléfono, ni dirección, ni la
   nota original del pedido. De la nota solo sale `notasProduccion`, que la
   base de datos ya entrega sin RUT, teléfonos ni correos. */

export interface GrupoTela {
  tela: string | null
  muebles: OrdenFabricacion[]
}

export interface GrupoModelo {
  modelo: string | null
  telas: GrupoTela[]
  total: number
}

export interface DatosHojaFabricacion {
  /* Muebles por modelo y, dentro, por tela. */
  modelos: GrupoModelo[]
  /* Patas extra, cojines, "10 cm adicional respaldo"...: van aparte, al final. */
  adicionales: OrdenFabricacion[]
  totalMuebles: number
}

/* Nombre y orden de los grupos: alfabético (sin distinguir tildes ni
   mayúsculas) y lo que no tiene modelo o tela, al final. */
const comparar = (a: string | null, b: string | null) => {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, 'es')
}
const limpio = (v: string | null) => v?.trim() || null

/* Agrupa por modelo y luego por tela. Dentro de cada grupo, del pedido más
   antiguo al más nuevo (la fecha exacta del pedido en Shopify; si empatan, por
   número de pedido y unidad). Las canceladas nunca entran. */
export function armarHojaFabricacion(ordenes: OrdenFabricacion[]): DatosHojaFabricacion {
  const vivas = ordenarParaExportar(ordenes.filter((o) => o.canceladoEn === null))
  const adicionales = vivas.filter((o) => o.esAdicional)
  const muebles = vivas.filter((o) => !o.esAdicional)

  const porModelo = new Map<string | null, Map<string | null, OrdenFabricacion[]>>()
  for (const o of muebles) {
    const modelo = limpio(o.modelo)
    const tela = limpio(o.tela)
    const telas = porModelo.get(modelo) ?? new Map<string | null, OrdenFabricacion[]>()
    telas.set(tela, [...(telas.get(tela) ?? []), o])
    porModelo.set(modelo, telas)
  }

  const modelos: GrupoModelo[] = [...porModelo.entries()]
    .sort(([a], [b]) => comparar(a, b))
    .map(([modelo, telas]) => {
      const lista = [...telas.entries()].sort(([a], [b]) => comparar(a, b)).map(([tela, m]) => ({ tela, muebles: m }))
      return { modelo, telas: lista, total: lista.reduce((n, t) => n + t.muebles.length, 0) }
    })

  return { modelos, adicionales, totalMuebles: muebles.length }
}

/* ---------------- Textos de cada fila ---------------- */

/* "SOFÁ EN L · izquierda"; sin orientación cuando no corresponde. */
export function tipoYOrientacion(o: Pick<OrdenFabricacion, 'tipo' | 'orientacion'>) {
  const orient = o.orientacion?.trim()
  const conOrientacion = orient && orient.toLowerCase() !== 'ninguna'
  return [o.tipo?.trim(), conOrientacion ? orient : null].filter(Boolean).join(' · ') || '—'
}

export const nombreGrupo = (valor: string | null, vacio: string) => valor ?? vacio

/* Qué falta para fabricar sin dudas, en texto para el taller. */
export function faltaParaFabricar(o: Pick<OrdenFabricacion, 'esAdicional' | 'color' | 'tela'>) {
  const falta = faltaColorTela(o)
  return falta ? `FALTA ${falta.toUpperCase()}` : null
}

/* ---------------- Alcance y nombre del archivo ---------------- */

export interface FiltrosParaHoja {
  desde: string
  hasta: string
  comuna: string
  modelo: string
  tela: string
  origen: string
}

/* "Muebles por fabricar · pedidos del 01-10-2026 al 31-10-2026 · con filtros
   de modelo y tela". Es lo que se imprime en el encabezado: deja claro qué
   abarca la hoja. */
export function describirAlcance(f: FiltrosParaHoja) {
  const partes = ['Muebles por fabricar']
  if (f.desde && f.hasta) partes.push(`pedidos del ${formatearFechaPedido(f.desde)} al ${formatearFechaPedido(f.hasta)}`)
  else if (f.desde) partes.push(`pedidos desde el ${formatearFechaPedido(f.desde)}`)
  else if (f.hasta) partes.push(`pedidos hasta el ${formatearFechaPedido(f.hasta)}`)
  else partes.push('todos los pedidos')
  const otros = [f.modelo && `modelo ${f.modelo}`, f.tela && `tela ${f.tela}`, f.comuna && `comuna ${f.comuna}`, f.origen !== 'todos' && f.origen && 'origen filtrado'].filter(Boolean)
  if (otros.length) partes.push(`filtrado por ${otros.join(', ')}`)
  return partes.join(' · ')
}

/* Para una selección a mano: dice cuántos eligieron y avisa si alguno ya no está
   "por fabricar" (por si se eligió por error). */
export function describirSeleccion(ordenes: Pick<OrdenFabricacion, 'estado'>[]) {
  const n = ordenes.length
  const yaAvanzados = ordenes.filter((o) => o.estado !== 'por_fabricar').length
  const base = `Selección de ${n} ${n === 1 ? 'mueble' : 'muebles'}`
  return yaAvanzados ? `${base} (${yaAvanzados} ya ${yaAvanzados === 1 ? 'no está' : 'no están'} por fabricar)` : base
}

/* hoja-fabricacion_2026-10-01_a_2026-10-31.xlsx; sin fechas, la de hoy; si es
   una selección, termina en _seleccion. */
export function nombreArchivoHojaFabricacion(f: Pick<FiltrosParaHoja, 'desde' | 'hasta'>, hoy: string, esSeleccion: boolean) {
  if (esSeleccion) return `hoja-fabricacion_${hoy}_seleccion.xlsx`
  const fechas = f.desde || f.hasta ? `_${f.desde || 'inicio'}_a_${f.hasta || hoy}` : `_${hoy}`
  return `hoja-fabricacion${fechas}.xlsx`
}

/* ---------------- Excel ---------------- */

export const COLUMNAS_HOJA_FABRICACION = [
  'Sección',
  'Modelo',
  'Tela',
  'N°',
  'Fecha pedido',
  'Tipo',
  'Orientación',
  'Medida',
  'Color',
  'Patas',
  'Notas de producción',
  'B',
  'I',
  'A',
  'C',
] as const

const ANCHOS = [11, 16, 24, 9, 12, 14, 12, 10, 16, 18, 48, 4, 4, 4, 4]

const texto = (valor: string | null | undefined): CellObject | null => {
  const v = valor?.trim()
  return v ? { value: v, type: String } : null
}

export interface HojaExcelFabricacion {
  datos: SheetData
  columnas: { width: number }[]
}

/* Una sola hoja, en el mismo orden que la hoja impresa: muebles por modelo y
   tela, y los adicionales al final. Las columnas B, I, A y C quedan vacías para
   marcar a mano. */
export function construirHojaExcelFabricacion(ordenes: OrdenFabricacion[]): HojaExcelFabricacion {
  const hoja = armarHojaFabricacion(ordenes)
  const encabezado: CellObject[] = COLUMNAS_HOJA_FABRICACION.map((titulo, i) => ({
    value: titulo,
    type: String,
    fontWeight: 'bold',
    backgroundColor: '#d9d9d9',
    align: i >= 11 ? 'center' : 'left',
  }))

  const fila = (seccion: string, modelo: string | null, tela: string | null, o: OrdenFabricacion, tipo: string, orientacion: string) => [
    texto(seccion),
    texto(modelo),
    texto(tela),
    texto(o.numero), // texto: "1180-1" no se convierte en fecha ni en número
    texto(formatearFechaPedido(o.fechaPedido)),
    texto(tipo),
    texto(orientacion),
    texto(o.cm),
    texto(o.color),
    texto(o.patas),
    { value: o.notasProduccion?.trim() || '', type: String, wrap: true, alignVertical: 'top' } as CellObject,
    null,
    null,
    null,
    null,
  ]

  const filas = [
    ...hoja.modelos.flatMap((g) =>
      g.telas.flatMap((t) =>
        t.muebles.map((o) => {
          const orient = o.orientacion?.trim().toLowerCase() === 'ninguna' ? '' : (o.orientacion ?? '')
          return fila('Mueble', g.modelo, t.tela, o, o.tipo ?? '', orient)
        }),
      ),
    ),
    ...hoja.adicionales.map((o) => fila('Adicional', null, null, o, o.tituloShopify ?? o.tipo ?? '', '')),
  ]

  return { datos: [encabezado, ...filas] as SheetData, columnas: ANCHOS.map((width) => ({ width })) }
}
