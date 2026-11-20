import type { Workbook, Worksheet } from 'exceljs'
import type { OrdenFabricacion } from '../types'
import { mencionaPatas } from './avisosOrden'
import { calcularPlazo, inicioDelPlazo, PLAZO_FABRICACION_DIAS, semaforoDelPlazo, type Calendario, type ColorPlazo, type SemaforoPlazo } from './diasHabiles'
import { regionComoEnPlanilla } from './hojaPedidos'
import { esPiezaFabricable } from './hojas'

/* El Excel de una hoja de fabricación, con el formato de la lista que el taller usa (archivos de
   contexto/Lista Pendiente 31-10-26.xlsx): una sola hoja, ordenada por N° de pedido. Lleva TODAS las piezas
   de la hoja (también las ya terminadas, con sus etapas marcadas); no lleva los pedidos cancelados, que la
   pantalla avisa aparte. No lleva RUT, teléfono ni correo: "Notas" es la nota de producción, que ya viene
   sin datos personales.

   Este archivo tiene dos partes: la lógica pura que decide qué fila lleva cada pieza (se prueba por
   separado) y el escritor del archivo (ExcelJS, que se carga recién al exportar). */

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

export interface FilaHoja {
  pedido: string
  unidad: number
  modelo: string
  medida: string
  lado: string
  tela: string
  direccion: string
  region: string
  patas: string
  /* La pieza ya no está por fabricar (fabricada, en despacho o entregada): su plazo dejó de correr. */
  terminada: boolean
  /* Días hábiles; null en las piezas terminadas. */
  transcurridos: number | null
  faltantes: number | null
  retraso: number | null
  /* El semáforo del plazo; null en las piezas terminadas. */
  plazo: SemaforoPlazo | null
  notas: string
  b: boolean
  i: boolean
  a: boolean
  c: boolean
  listo: boolean
}

export interface FilasHoja {
  filas: FilaHoja[]
  pedidos: number
  piezas: number
  /* De esas piezas, las que siguen por fabricar. */
  porFabricar: number
  /* El calendario de feriados no cubre algún año del cálculo: los días pueden estar mal. */
  sinCalendario: boolean
}

/* Una pieza de la hoja: mueble o cojín, que no esté cancelado. */
export const esPiezaDeHoja = (o: Pick<OrdenFabricacion, 'canceladoEn' | 'esAdicional' | 'tipo'>) => o.canceladoEn === null && esPiezaFabricable(o)

const esNumerico = (s: string) => /^\d+$/.test(s)

/* 1204 antes que 1224; "T9001" (no numérico) después de los numéricos. */
export const compararPedido = (a: string, b: string) =>
  esNumerico(a) && esNumerico(b) ? Number(a) - Number(b) : esNumerico(a) !== esNumerico(b) ? (esNumerico(a) ? -1 : 1) : a.localeCompare(b, 'es')

/* `ordenes`: todas las órdenes de la hoja. Salen todas sus piezas, ordenadas por N° de pedido y unidad. */
export function construirFilasHoja(ordenes: readonly OrdenFabricacion[], calendario: Calendario, hoy: string): FilasHoja {
  const porPedido = new Map<string, OrdenFabricacion[]>()
  for (const o of ordenes) porPedido.set(o.pedidoNumero, [...(porPedido.get(o.pedidoNumero) ?? []), o])
  const plazos = new Map<string, ReturnType<typeof calcularPlazo>>()
  let sinCalendario = false

  const filas = ordenes
    .filter(esPiezaDeHoja)
    .map<FilaHoja>((o) => {
      const terminada = o.estado !== 'por_fabricar'
      let plazo: ReturnType<typeof calcularPlazo> | null = null
      if (!terminada) {
        const inicio = inicioDelPlazo({ fechaPedido: o.fechaPedido, plazoDesde: o.plazoDesde })
        plazo = plazos.get(inicio) ?? calcularPlazo(inicio, hoy, calendario)
        plazos.set(inicio, plazo)
        sinCalendario ||= plazo.sinCalendario
      }
      const { medida, extra } = medidaDeLista(o.cm)
      /* La nota, lo que sobra de la medida y la composición del pedido; sin repetir lo que ya dice la nota. */
      const partes: string[] = []
      for (const parte of [o.notasProduccion?.trim(), extra, composicionDelPedido(porPedido.get(o.pedidoNumero) ?? [])]) {
        if (parte && !partes.join(' / ').toUpperCase().includes(parte.toUpperCase())) partes.push(parte)
      }
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
        terminada,
        transcurridos: plazo ? plazo.transcurridos : null,
        faltantes: plazo ? plazo.faltantes : null,
        retraso: plazo ? plazo.retraso : null,
        plazo: plazo ? semaforoDelPlazo(plazo) : null,
        notas: partes.join(' / '),
        b: o.etapaB,
        i: o.etapaI,
        a: o.etapaA,
        c: o.etapaC,
        /* Una pieza terminada siempre sale con LISTO marcado. */
        listo: o.listo || terminada,
      }
    })
    .sort((a, b) => compararPedido(a.pedido, b.pedido) || a.unidad - b.unidad)

  return {
    filas,
    pedidos: new Set(filas.map((f) => f.pedido)).size,
    piezas: filas.length,
    porFabricar: filas.filter((f) => !f.terminada).length,
    sinCalendario,
  }
}

/* "2026-11-08" -> "08-11-2026". */
const fechaCorta = (iso: string) => iso.split('-').reverse().join('-')

export function subtituloDeHoja(h: Pick<FilasHoja, 'pedidos' | 'piezas' | 'porFabricar'>, hoy: string) {
  return `Actualizado al ${fechaCorta(hoy)} · ${h.pedidos} ${h.pedidos === 1 ? 'pedido' : 'pedidos'} · ${h.piezas} ${h.piezas === 1 ? 'pieza' : 'piezas'} · ${h.porFabricar} por fabricar · plazo máximo de fabricación: ${PLAZO_FABRICACION_DIAS} días hábiles`
}

/* ---------------- El archivo ---------------- */

export const NOMBRE_HOJA_EXCEL = 'Hoja de fabricación'
export const TITULO_HOJA_EXCEL = 'HOJA DE FABRICACIÓN — ORDENADA POR Nº DE PEDIDO'

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
const BORDE = { style: 'thin', color: { argb: 'FFD9D9D9' } } as const
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE } as const

/* Los colores del plazo en las celdas de Días Hábiles Faltantes y de Retraso (esta, solo si hay retraso) (los de "Bueno", "Neutral" y "Malo" de Excel). */
export const COLORES_PLAZO: Record<ColorPlazo, { relleno: string; letra: string }> = {
  verde: { relleno: 'FFC6EFCE', letra: 'FF006100' },
  amarillo: { relleno: 'FFFFEB9C', letra: 'FF9C5700' },
  rojo: { relleno: 'FFFFC7CE', letra: 'FF9C0006' },
}

/* Alto de la fila según cuántas líneas ocupa el texto más largo de las columnas que se ajustan. */
export function altoDeFila(f: FilaHoja) {
  const lineas = Math.max(
    1,
    ...([[f.tela, ANCHOS[4]], [f.direccion, ANCHOS[5]], [f.patas, ANCHOS[7]], [f.notas, ANCHOS[11]]] as const).map(([t, w]) => Math.ceil(t.length / (w * 1.1))),
  )
  return lineas <= 1 ? 20.25 : Math.round((13.15 * lineas + 7.1) * 100) / 100
}

function escribirFila(hoja: Worksheet, f: FilaHoja, relleno: string, conPedido: boolean) {
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
    f.retraso ? f.retraso : null, // sin retraso, la celda queda vacía
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
    /* Faltantes lleva el color del plazo; Retraso solo se pinta (de rojo) cuando hay retraso de verdad. */
    const color = f.plazo && (c === 10 || (c === 11 && f.retraso)) ? COLORES_PLAZO[f.plazo.color] : null
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color?.relleno ?? relleno } }
    celda.font = color ? { name: 'Calibri', size: 10, bold: true, color: { argb: color.letra } } : { name: 'Calibri', size: 10 }
    celda.alignment = { horizontal: izquierda.has(c) ? 'left' : 'center', vertical: 'middle', ...(ajustar.has(c) ? { wrapText: true } : {}) }
    celda.border = BORDES
  }
}

function prepararHoja(libro: Workbook, subtitulo: string) {
  const hoja = libro.addWorksheet(NOMBRE_HOJA_EXCEL, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4', zoomScale: 90 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
  })
  ANCHOS.forEach((w, i) => (hoja.getColumn(i + 1).width = w))
  hoja.mergeCells('A1:L1')
  hoja.getCell('A1').value = TITULO_HOJA_EXCEL
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

/* Arma el archivo .xlsx. ExcelJS se carga aquí (import dinámico) para no pesar en el arranque de la app. */
export async function generarLibroHoja(datos: FilasHoja, hoy: string): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs')
  const libro = new ExcelJS.Workbook()
  const hoja = prepararHoja(libro, subtituloDeHoja(datos, hoy))
  let ultimo = ''
  let gris = true // el primer pedido va en blanco; cada pedido nuevo cambia de color
  for (const f of datos.filas) {
    const nuevo = f.pedido !== ultimo
    if (nuevo) gris = !gris
    escribirFila(hoja, f, gris ? 'FFF2F2F2' : 'FFFFFFFF', nuevo)
    ultimo = f.pedido
  }
  hoja.autoFilter = `A3:Q${hoja.rowCount}`
  return (await libro.xlsx.writeBuffer()) as ArrayBuffer
}

/* "Hoja de fabricación - Lote A 08-11-26.xlsx": sin los caracteres que Windows no admite en un nombre. */
export function nombreArchivoHoja(nombreHoja: string, hoy: string) {
  const [anio, mes, dia] = hoy.split('-')
  const limpio = nombreHoja.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${NOMBRE_HOJA_EXCEL} - ${limpio} ${dia}-${mes}-${anio.slice(2)}.xlsx`
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
