/* Días hábiles de fabricación. Todo con fechas "AAAA-MM-DD" (sin hora), en hora
   de Chile, y sin consultar la base de datos: así se puede probar por
   separado. El calendario de feriados llega de afuera (ver feriados.ts).

   La regla sale de la lista de pedidos pendientes del taller (31-10-2026) y
   coincide en las 89 filas:
     * Se cuentan los días de lunes a viernes que no son feriado.
     * El conteo empieza el DÍA SIGUIENTE al inicio (el día del pedido no cuenta)
       y llega hasta la fecha de corte, inclusive.
     * Faltantes = máx(0, plazo - transcurridos). Retraso = máx(0, transcurridos - plazo).
   El inicio es la fecha del pedido, salvo que se haya fijado otra
   (ordenes_fabricacion.plazo_desde: por ejemplo, un pago en la sala de ventas
   días después de crear el pedido). */

export const PLAZO_FABRICACION_DIAS = 14

export interface Calendario {
  /* Feriados como "AAAA-MM-DD". */
  feriados: ReadonlySet<string>
  /* Años de los que se cargó el calendario. Un año sin feriados cargados no se
     puede dar por bueno: contaría los feriados como días hábiles. */
  anios: ReadonlySet<number>
}

export function crearCalendario(fechas: Iterable<string>): Calendario {
  const feriados = new Set(fechas)
  return { feriados, anios: new Set([...feriados].map((f) => Number(f.slice(0, 4)))) }
}

/* Mediodía UTC: sumar días no se corre por cambios de hora. */
const aDate = (fecha: string) => new Date(`${fecha}T12:00:00Z`)
const aTexto = (d: Date) => d.toISOString().slice(0, 10)

export function sumarDias(fecha: string, dias: number) {
  const d = aDate(fecha)
  d.setUTCDate(d.getUTCDate() + dias)
  return aTexto(d)
}

/* 0 = domingo ... 6 = sábado. */
export const diaDeSemana = (fecha: string) => aDate(fecha).getUTCDay()

export function esDiaHabil(fecha: string, calendario: Calendario) {
  const dia = diaDeSemana(fecha)
  return dia !== 0 && dia !== 6 && !calendario.feriados.has(fecha)
}

/* Días hábiles entre `inicio` (que NO cuenta) y `corte` (que sí cuenta). Si el
   corte no es posterior al inicio, 0. */
export function contarDiasHabiles(inicio: string, corte: string, calendario: Calendario) {
  let n = 0
  for (let f = sumarDias(inicio, 1); f <= corte; f = sumarDias(f, 1)) {
    if (esDiaHabil(f, calendario)) n++
  }
  return n
}

export interface Plazo {
  transcurridos: number
  faltantes: number
  retraso: number
  /* true si algún año entre el inicio y el corte no tiene feriados cargados: el
     resultado puede estar mal y la pantalla debe avisarlo. */
  sinCalendario: boolean
}

export function calcularPlazo(inicio: string, corte: string, calendario: Calendario, plazo: number = PLAZO_FABRICACION_DIAS): Plazo {
  const transcurridos = contarDiasHabiles(inicio, corte, calendario)
  let sinCalendario = false
  for (let anio = Number(inicio.slice(0, 4)); anio <= Number(corte.slice(0, 4)); anio++) {
    if (!calendario.anios.has(anio)) sinCalendario = true
  }
  return {
    transcurridos,
    faltantes: Math.max(0, plazo - transcurridos),
    retraso: Math.max(0, transcurridos - plazo),
    sinCalendario,
  }
}

/* Desde cuándo se cuenta el plazo de una orden. */
export function inicioDelPlazo(orden: { fechaPedido: string; plazoDesde?: string | null }) {
  return orden.plazoDesde || orden.fechaPedido
}

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' })

/* La fecha de hoy en Chile (no la del dispositivo ni la de UTC). */
export function hoyEnChile(ahora: Date = new Date()) {
  return formatoDia.format(ahora)
}
