import type { Workbook, Worksheet } from 'exceljs'
import type { OrdenFabricacion } from '../types'
import { mencionaPatas } from './avisosOrden'
import { calcularPlazo, inicioDelPlazo, PLAZO_FABRICACION_DIAS, type Calendario } from './diasHabiles'
import { regionComoEnPlanilla } from './hojaPedidos'
import { esPiezaFabricable } from './hojas'

/* "Lista Pendiente": el Excel de una hoja de fabricación, con el formato de la lista que el
   taller usa (archivos de contexto/Lista Pendiente 31-10-26.xlsx). Lleva solo las piezas que
   siguen POR FABRICAR, en dos hojas: ordenadas por N° de pedido y agrupadas por modelo y
   medidas. No lleva RUT, teléfono ni correo: "Notas" es la nota de producción, que ya viene
   sin datos personales.

   Este archivo tiene dos partes: la lógica pura que decide qué fila lleva cada pieza (se
   prueba por separado) y el escritor del archivo (ExcelJS, que se carga recién al exportar). */

/* ---------------- Cómo se ve cada dato ---------------- */

/* Los colores se guardan sin tilde en la base; la lista los escribe como se dicen. */
const conTilde = (texto: string) =>
  texto
    .replace(/\bCAFE\b/g, 'CAFÉ')
    .replace(/\bMARRON\b/g, 'MARRÓN')
    .replace(/\bPETROLEO\b/g, 'PETRÓLEO')
    .replace(/\bPUCON\b/g, 'PUCÓN')

/* "SOFÁ" + "OSORNO" -> "SOFÁ OSORNO"; "POLTRONA" -> "POL."; "SOFÁ EN L" -> "L"; el cojín lleva su
   propio nombre ("COJIN 91X105X10" -> "COJÍN 91X105X10"). */
export function modeloDeLista(o: Pick<OrdenFabricacion, 'tipo' | 'modelo'>) {
  const modelo = (o.modelo ?? '').trim().toUpperCase()
  const tipo = (o.tipo ?? '').trim().toUpperCase()
  if (tipo === 'COJÍN') return modelo.replace(/^COJIN\b/, 'COJÍN')
  const prefijo = tipo === 'POLTRONA' ? 'POL.' : tipo === 'SOFÁ EN L' ? 'L' : tipo
  return [prefijo, modelo].filter(Boolean).join(' ')
}

/* "175 cm" -> "175"; "220 cm x 150 cm" -> "220X150"; "ESTÁNDAR" o vacío -> "". Lo que venga después de
   los números ("190cm Confort Size - Colchón Full") no se pierde: sale aparte para ir a las notas. */
export function medidaDeLista(cm: string | null) {
  const texto = (cm ?? '').trim()
  const m = /^(\d+)\s*(?:cm)?\s*(?:x\s*(\d+)\s*(?:cm)?)?\s*(.*)$/i.exec(texto)
  if (!m) return { medida: '', extra: null as string | null }
  const extra = m[3].trim().replace(/^[-–]\s*/, '')
  return { medida: m[2] ? `${m[1]}X${m[2]}` : m[1], extra: extra ? extra.toUpperCase() : null }
}

export function ladoDeLista(orientacion: string | null) {
  const o = (orientacion ?? '').trim().toLowerCase()
  return o === 'izquierda' ? 'Izquierda' : o === 'derecha' ? 'Derecha' : ''
}

/* ("LINO HIDROREPELENTE", "CRUDO") -> "LINO CRUDO"; ("CUERO BLEND", "CAFE CLARO") -> "CUERO CAFÉ CLARO". */
export function telaDeLista(o: Pick<OrdenFabricacion, 'tela' | 'color'>) {
  const tela = (o.tela ?? '').trim().toUpperCase()
  const familia = /^LINO\b/.test(tela) ? 'LINO' : /^CUERO\b/.test(tela) ? 'CUERO' : tela
  return [familia, conTilde((o.color ?? '').trim().toUpperCase())].filter(Boolean).join(' ')
}

/* "Dirección" es la comuna; los retiros en tienda y los pedidos sin dirección se dicen con palabras. */
export function direccionDeLista(comuna: string | null) {
  const c = (comuna ?? '').trim()
  if (!c || /^NO SE PROPORCION/i.test(c)) return 'SIN DIRECCIÓN'
  if (/^RETIRO/i.test(c)) return 'RETIRO'
  return c.toUpperCase()
}

export function patasDeLista(o: Pick<OrdenFabricacion, 'esAdicional' | 'notasProduccion' | 'patas'>) {
  return mencionaPatas(o) ? 'VER NOTAS' : (o.patas || 'PREDETERMINADAS').trim().toUpperCase()
}

/* "PEDIDO DE 1 SOFÁ + 2 POLTRONAS" para los pedidos de varias piezas; null si es una sola. Cuenta las
   piezas del pedido (muebles y cojines, no las canceladas) aunque alguna ya esté fabricada. */
export function composicionDelPedido(piezas: readonly Pick<OrdenFabricacion, 'tipo' | 'esAdicional' | 'canceladoEn'>[]) {
  const validas = piezas.filter((p) => p.canceladoEn === null && esPiezaFabricable(p))
  if (validas.length < 2) return null
  const cuenta = { sofa: 0, poltrona: 0, cojin: 0 }
  for (const p of validas) {
    if (p.tipo === 'POLTRONA') cuenta.poltrona++
    else if (p.tipo === 'COJÍN') cuenta.cojin++
    else cuenta.sofa++
  }
  const partes = [
    cuenta.sofa && `${cuenta.sofa} ${cuenta.sofa === 1 ? 'SOFÁ' : 'SOFÁS'}`,
    cuenta.poltrona && `${cuenta.poltrona} ${cuenta.poltrona === 1 ? 'POLTRONA' : 'POLTRONAS'}`,
    cuenta.cojin && `${cuenta.cojin} ${cuenta.cojin === 1 ? 'COJÍN' : 'COJINES'}`,
  ].filter(Boolean)
  return `PEDIDO DE ${partes.join(' + ')}`
}

/* ---------------- Las filas ---------------- */

export interface FilaLista {
  pedido: string
  unidad: number
  modelo: string
  medida: string
  lado: string
  tela: string
  direccion: string
  region: string
  patas: string
  transcurridos: number
  faltantes: number
  retraso: number
  notas: string
  b: boolean
  i: boolean
  a: boolean
  c: boolean
  listo: boolean
}

export interface ListaPendiente {
  filas: FilaLista[]
  pedidos: number
  piezas: number
  /* El calendario de feriados no cubre algún año del cálculo: los días pueden estar mal. */
  sinCalendario: boolean
}

export const esPendiente = (o: Pick<OrdenFabricacion, 'estado' | 'canceladoEn' | 'esAdicional' | 'tipo'>) =>
  o.estado === 'por_fabricar' && o.canceladoEn === null && esPiezaFabricable(o)

const esNumerico = (s: string) => /^\d+$/.test(s)

/* 1204 antes que 1224; "T9001" (no numérico) después de los numéricos. */
export const compararPedido = (a: string, b: string) => (esNumerico(a) && esNumerico(b) ? Number(a) - Number(b) : esNumerico(a) !== esNumerico(b) ? (esNumerico(a) ? -1 : 1) : a.localeCompare(b, 'es'))

/* `ordenes`: todas las piezas de la hoja (también las ya fabricadas y las canceladas): las usa para
   describir cada pedido, pero solo las pendientes llegan a la lista. */
export function construirListaPendiente(ordenes: readonly OrdenFabricacion[], calendario: Calendario, hoy: string): ListaPendiente {
  const porPedido = new Map<string, OrdenFabricacion[]>()
  for (const o of ordenes) porPedido.set(o.pedidoNumero, [...(porPedido.get(o.pedidoNumero) ?? []), o])
  const plazos = new Map<string, ReturnType<typeof calcularPlazo>>()
  let sinCalendario = false

  const filas = ordenes.filter(esPendiente).map<FilaLista>((o) => {
    const inicio = inicioDelPlazo({ fechaPedido: o.fechaPedido, plazoDesde: o.plazoDesde })
    let plazo = plazos.get(inicio)
    if (!plazo) {
      plazo = calcularPlazo(inicio, hoy, calendario)
      plazos.set(inicio, plazo)
    }
    sinCalendario ||= plazo.sinCalendario
    const { medida, extra } = medidaDeLista(o.cm)
    /* La nota, lo que sobra de la medida y la composición del pedido; sin repetir lo que ya dice la nota. */
    const partes: string[] = []
    for (const parte of [o.notasProduccion?.trim(), extra, composicionDelPedido(porPedido.get(o.pedidoNumero) ?? [])]) {
      if (parte && !partes.join(' / ').toUpperCase().includes(parte.toUpperCase())) partes.push(parte)
    }
    const notas = partes.join(' / ')
    return {
      pedido: o.pedidoNumero,
      unidad: Number(o.numero.split('-')[1]) || 0,
      modelo: modeloDeLista(o),
      medida,
      lado: ladoDeLista(o.orientacion),
      tela: telaDeLista(o),
      direccion: direccionDeLista(o.comuna),
      region: regionComoEnPlanilla(o.region) ?? '',
      patas: patasDeLista(o),
      transcurridos: plazo.transcurridos,
      faltantes: plazo.faltantes,
      retraso: plazo.retraso,
      notas,
      b: o.etapaB,
      i: o.etapaI,
      a: o.etapaA,
      c: o.etapaC,
      listo: o.listo,
    }
  })

  return { filas, pedidos: new Set(filas.map((f) => f.pedido)).size, piezas: filas.length, sinCalendario }
}

/* Hoja 1: por N° de pedido (y, dentro del pedido, por unidad). */
export const ordenarPorPedido = (filas: readonly FilaLista[]) =>
  [...filas].sort((a, b) => compararPedido(a.pedido, b.pedido) || a.unidad - b.unidad)

const numerosDeMedida = (medida: string) => (medida ? medida.split('X').map(Number) : [])
export function compararMedida(a: string, b: string) {
  const x = numerosDeMedida(a)
  const y = numerosDeMedida(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1)
    if (d) return d
  }
  return 0
}

/* Hoja 2: grupos por modelo (en orden alfabético) y, dentro de cada uno, por medida y luego por pedido. */
export function agruparPorModelo(filas: readonly FilaLista[]) {
  const grupos = new Map<string, FilaLista[]>()
  for (const f of filas) grupos.set(f.modelo, [...(grupos.get(f.modelo) ?? []), f])
  return [...grupos.keys()]
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((modelo) => ({
      modelo,
      filas: grupos.get(modelo)!.sort((a, b) => compararMedida(a.medida, b.medida) || compararPedido(a.pedido, b.pedido) || a.unidad - b.unidad),
    }))
}

/* "2026-11-08" -> "08-11-2026". */
const fechaCorta = (iso: string) => iso.split('-').reverse().join('-')

export function subtituloDeLista(lista: Pick<ListaPendiente, 'pedidos' | 'piezas'>, hoy: string) {
  const { pedidos, piezas } = lista
  return `Actualizado al ${fechaCorta(hoy)} · ${pedidos} ${pedidos === 1 ? 'pedido' : 'pedidos'} · ${piezas} ${piezas === 1 ? 'pieza' : 'piezas'} · plazo máximo de fabricación: ${PLAZO_FABRICACION_DIAS} días hábiles`
}

/* ---------------- El archivo ---------------- */

export const ENCABEZADOS = [
  'Nº Pedido',
  'Modelo Sofá',
  'CM (Medida)',
  'Lado',
  'Tela',
  'Dirección',
  'Región',
  'Patas',
  'Días Hábiles Transcurridos',
  'Días Hábiles Faltantes',
  'Días Hábiles de Retraso',
  'Notas',
  'B',
  'I',
  'A',
  'C',
  'LISTO',
] as const

export const ANCHOS = [12, 20, 14, 12, 27, 18, 16, 17, 14, 12, 12, 50, 6, 6, 6, 6, 8]
const AZUL = 'FF1F4E79'
const ROJO = 'FFC00000'
const BORDE = { style: 'thin', color: { argb: 'FFD9D9D9' } } as const
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE } as const

/* Alto de la fila según cuántas líneas ocupa el texto más largo de las columnas que se ajustan. */
export function altoDeFila(f: FilaLista) {
  const lineas = Math.max(
    1,
    ...([[f.tela, ANCHOS[4]], [f.direccion, ANCHOS[5]], [f.patas, ANCHOS[7]], [f.notas, ANCHOS[11]]] as const).map(([t, w]) => Math.ceil(t.length / (w * 1.1))),
  )
  return lineas <= 1 ? 20.25 : Math.round((13.15 * lineas + 7.1) * 100) / 100
}

function escribirFila(hoja: Worksheet, f: FilaLista, relleno: string, conPedido: boolean) {
  const fila = hoja.addRow([
    conPedido ? (esNumerico(f.pedido) ? Number(f.pedido) : f.pedido) : null,
    f.modelo,
    f.medida,
    f.lado,
    f.tela,
    f.direccion,
    f.region,
    f.patas,
    f.transcurridos,
    f.faltantes,
    f.retraso,
    f.notas,
    f.b ? 'X' : '',
    f.i ? 'X' : '',
    f.a ? 'X' : '',
    f.c ? 'X' : '',
    f.listo ? 'X' : '',
  ])
  fila.height = altoDeFila(f)
  const izquierda = new Set([2, 5, 6, 7, 8, 12])
  const ajustar = new Set([5, 6, 8, 12])
  for (let c = 1; c <= 17; c++) {
    const celda = fila.getCell(c)
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: relleno } }
    celda.font = c === 11 && f.retraso > 0 ? { name: 'Calibri', size: 10, bold: true, color: { argb: ROJO } } : { name: 'Calibri', size: 10 }
    celda.alignment = { horizontal: izquierda.has(c) ? 'left' : 'center', vertical: 'middle', ...(ajustar.has(c) ? { wrapText: true } : {}) }
    celda.border = BORDES
  }
}

function prepararHoja(libro: Workbook, nombre: string, titulo: string, subtitulo: string) {
  const hoja = libro.addWorksheet(nombre, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4', zoomScale: 90 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
  })
  ANCHOS.forEach((w, i) => (hoja.getColumn(i + 1).width = w))
  hoja.mergeCells('A1:L1')
  hoja.getCell('A1').value = titulo
  hoja.getCell('A1').font = { name: 'Calibri', size: 14, bold: true, color: { argb: AZUL } }
  hoja.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' }
  hoja.getRow(1).height = 24.95
  hoja.mergeCells('A2:L2')
  hoja.getCell('A2').value = subtitulo
  hoja.getCell('A2').font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF595959' } }
  hoja.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' }
  const encabezado = hoja.getRow(3)
  ENCABEZADOS.forEach((t, i) => {
    const c = encabezado.getCell(i + 1)
    c.value = t
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  encabezado.height = 45
  return hoja
}

/* Arma el archivo .xlsx con las dos hojas. ExcelJS se carga aquí (import dinámico) para no pesar en
   el arranque de la app. */
export async function generarLibroListaPendiente(lista: ListaPendiente, hoy: string): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs')
  const libro = new ExcelJS.Workbook()
  const subtitulo = subtituloDeLista(lista, hoy)

  const porPedido = prepararHoja(libro, 'Pedidos Pendientes', 'LISTA DE PEDIDOS PENDIENTES — ORDENADOS POR Nº DE PEDIDO', subtitulo)
  let ultimo = ''
  let gris = true // el primer pedido va en blanco; cada pedido nuevo cambia de color
  for (const f of ordenarPorPedido(lista.filas)) {
    const nuevo = f.pedido !== ultimo
    if (nuevo) gris = !gris
    escribirFila(porPedido, f, gris ? 'FFF2F2F2' : 'FFFFFFFF', nuevo)
    ultimo = f.pedido
  }
  porPedido.autoFilter = `A3:Q${porPedido.rowCount}`

  const porModelo = prepararHoja(libro, 'Pedidos por Modelo y Medidas', 'LISTA DE PEDIDOS PENDIENTES — AGRUPADOS POR MODELO Y MEDIDAS', subtitulo)
  for (const grupo of agruparPorModelo(lista.filas)) {
    const fila = porModelo.addRow([`MODELO: ${grupo.modelo}`])
    porModelo.mergeCells(fila.number, 1, fila.number, 17)
    fila.height = 20.1
    const c = fila.getCell(1)
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: AZUL } }
    c.alignment = { horizontal: 'left', vertical: 'middle' }
    c.border = { bottom: BORDE }
    grupo.filas.forEach((f, i) => escribirFila(porModelo, f, i % 2 === 0 ? 'FFFFFFFF' : 'FFF2F2F2', true))
  }

  return (await libro.xlsx.writeBuffer()) as ArrayBuffer
}

/* "Lista Pendiente - Lote A 08-11-26.xlsx": sin los caracteres que Windows no admite en un nombre. */
export function nombreArchivoLista(nombreHoja: string, hoy: string) {
  const [anio, mes, dia] = hoy.split('-')
  const limpio = nombreHoja.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `Lista Pendiente - ${limpio} ${dia}-${mes}-${anio.slice(2)}.xlsx`
}

/* Descarga el archivo en el navegador. */
export function descargarArchivo(datos: ArrayBuffer, nombre: string) {
  const url = URL.createObjectURL(new Blob([datos], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
