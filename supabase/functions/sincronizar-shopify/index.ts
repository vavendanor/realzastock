// ============================================================
// Edge Function: sincronizar-shopify
// ============================================================
// Lee de Shopify los pedidos modificados desde la última sincronización y
// los guarda como órdenes de fabricación (una fila por mueble) en Supabase.
// La app lee SOLO de Supabase: nunca de Shopify desde el navegador.
//
// Quién puede llamarla (la verificación de JWT de Supabase se DESACTIVA al
// desplegar, porque el cron no tiene un JWT; por eso la autenticación es lo
// PRIMERO que hace esta función, antes de leer Shopify o escribir nada, y
// falla cerrada):
//   1) El cron (pg_cron + pg_net): header "x-cron-secret" igual al secreto
//      CRON_SECRET (mínimo 32 caracteres), comparado en tiempo constante.
//   2) Un administrador logueado: "Authorization: Bearer <token>" de un
//      usuario cuyo rol en la tabla "usuarios" sea "administrador".
//   Cualquier otra cosa -> 401 / 403.
//
// Secretos que debes crear en Supabase (Edge Functions -> Secrets):
//   SHOPIFY_SHOP          subdominio de la tienda, p. ej. "realza-hogar"
//                         (sin https:// ni .myshopify.com; si se pega
//                         completo, se normaliza)
//   SHOPIFY_ACCESS_TOKEN  token de la Admin API (empieza con "shpat_")
//   CRON_SECRET           cadena aleatoria de 64 caracteres hexadecimales
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las inyecta
// Supabase solas.
//
// Parámetros (en la URL):
//   ?dry=1     NO escribe nada (ni órdenes, ni la marca de "en curso", ni
//              sync_shopify): lee Shopify, mapea y devuelve qué haría.
//   ?filas=1   (con dry=1) incluye todas las filas mapeadas, SIN datos
//              personales, para compararlas con la planilla.
//   ?desde=AAAA-MM-DD   reprocesa desde esa fecha (nunca antes de
//              sync_shopify.importar_desde).
//
// Reglas de la sincronización:
//   * Idempotente: la clave de cada mueble es (id de la línea de Shopify,
//     unidad). Reprocesar un pedido solo actualiza los datos que vienen de
//     Shopify; NUNCA toca las etapas B, I, A, C, LISTO ni el estado.
//   * Pedidos cancelados en Shopify: las órdenes ya importadas se marcan
//     canceladas (cancelado_en); los cancelados nuevos no se importan.
//   * Si una línea baja de cantidad o desaparece, las unidades que sobran se
//     cancelan SOLO si no tienen avance; si lo tienen, se deja una
//     advertencia y no se tocan.
//   * Evita corridas solapadas con reservar_sync_shopify() (migración 0014).
//   * La respuesta nunca incluye datos personales (nombres, teléfonos,
//     direcciones, notas): solo números de pedido y conteos.
// Hay un bloque con los pasos de despliegue al final del archivo.
// ============================================================


// ------------------------------------------------------------
// 1. Constantes y tipos
// ------------------------------------------------------------
const VERSION_API = '2026-10'
const ZONA = 'America/Santiago'
/* Se vuelve a leer un poco antes de la última sincronización por si Shopify
   confirmó algún cambio con retraso. Es seguro: todo es idempotente. */
const SOLAPE_MS = 10 * 60 * 1000
/* Margen bajo el límite de tiempo de una Edge Function. */
const LIMITE_MS = 100_000
/* Shopify rechaza consultas "demasiado caras" (pedidos x líneas). Estos
   tamaños dejan el costo solicitado muy por debajo del límite de 1000. */
const PEDIDOS_POR_PAGINA = 15
const LINEAS_POR_PEDIDO = 25
const MODELOS = ['VALENCIA', 'OSORNO', 'CHILLAN', 'FRUTILLAR', 'VILLARRICA', 'MENDOZA']
const SIN_DIRECCION = 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO'
/* Líneas que no van a fabricación (el cobro del despacho). */
const IGNORAR = /^despacho$/i
const TIPOS_MUEBLE = ['SOFA', 'SOFA EN L', 'SOFA CAMA', 'POLTRONA']

export interface OpcionShopify {
  name: string
  value: string
}

export interface LineaShopify {
  id: string
  title: string | null
  currentQuantity: number
  variantTitle: string | null
  variant: { selectedOptions: OpcionShopify[] } | null
  product: { title: string | null; productType: string | null; description: string | null } | null
}

export interface PedidoShopify {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  cancelledAt: string | null
  note: string | null
  sourceName: string | null
  customer: { displayName: string | null } | null
  shippingLine: { title: string | null } | null
  shippingAddress: {
    name: string | null
    address1: string | null
    address2: string | null
    city: string | null
    province: string | null
    phone: string | null
  } | null
  tela: { value: string | null } | null
  patas: { value: string | null } | null
  lineItems: { pageInfo?: { hasNextPage: boolean }; nodes: LineaShopify[] }
}

/* Las columnas de ordenes_fabricacion que escribe esta función (y SOLO esas:
   por eso reprocesar no pisa etapas ni estado). */
export interface FilaOrden {
  numero: string
  pedido_numero: string
  shopify_order_id: string
  shopify_line_item_id: string
  unidad: number
  tipo: string | null
  modelo: string | null
  orientacion: string | null
  cm: string | null
  color: string | null
  tela: string | null
  region: string | null
  comuna: string | null
  patas: string
  titulo_shopify: string | null
  pedido_creado_en: string
  origen_shopify: string | null
}

/* Datos personales: van a ordenes_fabricacion_cliente. */
export interface DatosCliente {
  cliente: string | null
  telefono: string | null
  inf_adicional: string | null
  direccion: string | null
}

export interface FilaCliente extends DatosCliente {
  orden_id: string
  actualizado_en: string
}


// ------------------------------------------------------------
// 2. Mapeo de un pedido de Shopify a filas de fabricación
// ------------------------------------------------------------
// Reglas tomadas del script de ejemplo (Apps Script). Una fila por mueble:
// una línea con cantidad 3 genera 3 filas. La base de datos normaliza
// después comunas, colores, tipo, región y las notas (migraciones 0012-0013).

const sinTilde = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
const may = (s: unknown) => String(s ?? '').trim().toUpperCase()
const nulo = (s: string) => (s.trim() === '' ? null : s)

function opcion(li: LineaShopify, regex: RegExp) {
  const opciones = li.variant?.selectedOptions ?? []
  const o = opciones.find((x) => regex.test(x.name))
  return o ? o.value : ''
}

/* "Sofá en L Valencia - Cuero Blend" -> { tipo, modelo, tela } */
function analizarTitulo(li: LineaShopify) {
  const titulo = ((li.product ? li.product.title : li.title) || '').trim()
  const partes = titulo.split(' - ')
  const tela = partes.length > 1 ? (partes.pop() as string) : ''
  const base = partes.join(' - ')
  const t = sinTilde(titulo)

  let tipo = li.product?.productType || ''
  if (/SOFA EN L/.test(t)) tipo = 'Sofá en L'
  else if (/SOFA CAMA/.test(t)) tipo = 'Sofá Cama'
  else if (!tipo) tipo = /POLTRONA/.test(t) ? 'Poltrona' : /COJIN/.test(t) ? 'Cojín' : /SOFA/.test(t) ? 'Sofá' : ''

  const modeloConocido = MODELOS.find((m) => t.includes(m))
  let modelo: string
  if (modeloConocido) {
    modelo = modeloConocido === 'CHILLAN' ? 'CHILLÁN' : modeloConocido
    if (!tipo) tipo = 'Sofá'
  } else {
    modelo = may(base.replace(/^(sof[aá] en l|sof[aá] cama|sof[aá]|poltrona)\s*-?\s*/i, '')) || may(titulo)
  }
  return { tipo: may(tipo), modelo, tela: may(tela) }
}

/* Solo los sofás en L tienen orientación. Primero la opción elegida; solo si
   no dice nada, el título de la variante y la descripción del producto. Si
   no se puede determinar, queda "REVISAR" para que alguien lo mire. */
function orientacion(li: LineaShopify, tipo: string) {
  if (tipo !== 'SOFÁ EN L') return 'ninguna'
  const fuentes = [opcion(li, /orient|lado/i), li.variantTitle, li.product?.description]
  for (const f of fuentes) {
    const txt = sinTilde(f)
    const izq = /IZQ/.test(txt)
    const der = /DER/.test(txt)
    if (izq && !der) return 'izquierda'
    if (der && !izq) return 'derecha'
  }
  return 'REVISAR'
}

function regionNormalizada(r: string | null | undefined) {
  const v = may(r)
  return v === 'SANTIAGO' || /METROPOLITANA/.test(sinTilde(v)) ? 'METROPOLITANA' : v
}

export function esMueble(tipo: string | null) {
  return tipo !== null && TIPOS_MUEBLE.includes(sinTilde(tipo))
}

export interface MuebleMapeado {
  fila: FilaOrden
  /* Motivos por los que alguien debería mirar esta fila (para el modo dry). */
  revisar: string[]
}

export interface ResultadoMapeo {
  muebles: MuebleMapeado[]
  cliente: DatosCliente
}

export function mapearPedido(o: PedidoShopify): ResultadoMapeo {
  const retiro = Boolean(o.shippingLine?.title && /retiro/i.test(o.shippingLine.title))
  const dir = o.shippingAddress
  const region = retiro || !dir ? '' : regionNormalizada(dir.province)
  const comuna = retiro ? 'RETIRO TIENDA' : !dir ? SIN_DIRECCION : may(dir.city)
  const numeroPedido = o.name.replace('#', '')

  const muebles: MuebleMapeado[] = []
  for (const li of o.lineItems.nodes) {
    if (IGNORAR.test((li.title || '').trim())) continue
    const a = analizarTitulo(li)
    const titulo = (li.product ? li.product.title : li.title) || ''
    const cmTitulo = (titulo.match(/(\d{2,3})\s*cm/i) || [])[1]
    const cm =
      opcion(li, /medida|tama|cm|dimens/i) || (cmTitulo ? `${cmTitulo} cm` : '') || (a.tipo === 'POLTRONA' ? 'ESTÁNDAR' : '')
    const color = may(opcion(li, /color/i))
    const tela = may(o.tela?.value) || a.tela || may(opcion(li, /tela|material/i))
    const patas = may(o.patas?.value) || 'PREDETERMINADAS'
    const orient = orientacion(li, a.tipo)

    for (let i = 0; i < li.currentQuantity; i++) {
      const fila: FilaOrden = {
        numero: '', // se completa abajo, cuando se sabe cuántos muebles tiene el pedido
        pedido_numero: numeroPedido,
        shopify_order_id: o.id,
        shopify_line_item_id: li.id,
        unidad: i + 1,
        tipo: nulo(a.tipo),
        modelo: nulo(a.modelo),
        orientacion: nulo(orient),
        cm: nulo(cm),
        color: nulo(color),
        tela: nulo(tela),
        region: nulo(region),
        comuna: nulo(comuna),
        patas,
        titulo_shopify: nulo(titulo),
        pedido_creado_en: o.createdAt,
        origen_shopify: o.sourceName ? o.sourceName : null,
      }
      const revisar: string[] = []
      if (esMueble(fila.tipo)) {
        if (orient === 'REVISAR') revisar.push('orientación sin determinar')
        if (!fila.tela) revisar.push('sin tela')
        if (!fila.color) revisar.push('sin color')
        if (!fila.cm) revisar.push('sin medida')
      }
      if (!retiro && dir && !fila.comuna) revisar.push('sin comuna')
      muebles.push({ fila, revisar })
    }
  }

  /* Número: 1266 si es un solo mueble; 1265-1, 1265-2... si son varios. */
  muebles.forEach((m, i) => {
    m.fila.numero = muebles.length > 1 ? `${numeroPedido}-${i + 1}` : numeroPedido
  })

  const direccion = retiro || !dir ? '' : [dir.address1, dir.address2].filter(Boolean).join(', ')
  const cliente: DatosCliente = {
    cliente: nulo(dir?.name || o.customer?.displayName || ''),
    telefono: nulo(dir?.phone || ''),
    inf_adicional: nulo(o.note || ''),
    direccion: nulo(direccion),
  }
  return { muebles, cliente }
}


// ------------------------------------------------------------
// 3. Fechas en hora de Chile
// ------------------------------------------------------------
const formatoZona = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function partesEnZona(d: Date) {
  const r: Record<string, number> = {}
  for (const p of formatoZona.formatToParts(d)) if (p.type !== 'literal') r[p.type] = Number(p.value)
  return r
}

const dos = (n: number) => String(n).padStart(2, '0')

/* El día (AAAA-MM-DD) en que cae un instante, en hora de Chile: un pedido de
   las 22:00 del día 31 no puede contarse como día 1 del mes siguiente. */
export function fechaChile(instante: string | Date) {
  const p = partesEnZona(new Date(instante))
  return `${String(p.year).padStart(4, '0')}-${dos(p.month)}-${dos(p.day)}`
}

/* El instante en que empieza ese día (00:00) en hora de Chile. */
export function inicioDiaChile(fecha: string) {
  const [y, m, d] = fecha.split('-').map(Number)
  const objetivo = Date.UTC(y, m - 1, d, 0, 0, 0)
  let t = objetivo
  for (let i = 0; i < 3; i++) {
    const p = partesEnZona(new Date(t))
    t += objetivo - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  }
  return new Date(t)
}


// ------------------------------------------------------------
// 4. Cliente de Shopify (GraphQL Admin API)
// ------------------------------------------------------------
export class ErrorShopify extends Error {}

export interface ClienteShopify {
  consultar(query: string, variables: Record<string, unknown>): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function crearClienteShopify(
  shop: string,
  token: string,
  fetchFn: typeof fetch,
  esperar: (ms: number) => Promise<void> = pausa,
): ClienteShopify {
  const url = `https://${shop}.myshopify.com/admin/api/${VERSION_API}/graphql.json`
  return {
    async consultar(query, variables) {
      let fallosDeRed = 0
      let fallosDeVelocidad = 0
      for (;;) {
        let res: Response
        try {
          res = await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
            body: JSON.stringify({ query, variables }),
          })
        } catch {
          if (++fallosDeRed > 3) throw new ErrorShopify('No se pudo conectar con Shopify.')
          await esperar(1000 * 2 ** (fallosDeRed - 1))
          continue
        }

        if (res.status === 401 || res.status === 403) {
          throw new ErrorShopify(
            `Shopify rechazó las credenciales (HTTP ${res.status}). Revisa SHOPIFY_ACCESS_TOKEN y los permisos de la app.`,
          )
        }
        if (res.status === 404) {
          throw new ErrorShopify('Shopify respondió 404. Revisa SHOPIFY_SHOP (el subdominio de la tienda).')
        }
        if (res.status === 429 || res.status >= 500) {
          if (++fallosDeRed > 3) throw new ErrorShopify(`Shopify no respondió bien (HTTP ${res.status}).`)
          await esperar(1000 * 2 ** (fallosDeRed - 1))
          continue
        }
        if (!res.ok) throw new ErrorShopify(`Shopify respondió HTTP ${res.status}.`)

        let json: any // eslint-disable-line @typescript-eslint/no-explicit-any
        try {
          json = await res.json()
        } catch {
          throw new ErrorShopify('Shopify devolvió una respuesta que no es JSON.')
        }
        if (json?.errors?.length) {
          const limitado = json.errors.some((e: any) => e?.extensions?.code === 'THROTTLED') // eslint-disable-line @typescript-eslint/no-explicit-any
          if (limitado && ++fallosDeVelocidad <= 4) {
            await esperar(2000 * fallosDeVelocidad)
            continue
          }
          const mensajes = json.errors.map((e: any) => String(e?.message ?? 'error')).join('; ') // eslint-disable-line @typescript-eslint/no-explicit-any
          throw new ErrorShopify(`Shopify devolvió errores: ${mensajes.slice(0, 400)}`)
        }
        return json.data
      }
    },
  }
}

/* sortKey UPDATED_AT ascendente: así se puede registrar hasta dónde se
   avanzó aunque la corrida se corte a la mitad. */
const QUERY_PEDIDOS = `query($q: String, $after: String) {
  orders(first: ${PEDIDOS_POR_PAGINA}, after: $after, sortKey: UPDATED_AT, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt cancelledAt note sourceName
      customer { displayName }
      shippingLine { title }
      shippingAddress { name address1 address2 city province phone }
      tela: metafield(namespace: "custom", key: "tela") { value }
      patas: metafield(namespace: "custom", key: "patas") { value }
      lineItems(first: ${LINEAS_POR_PEDIDO}) {
        pageInfo { hasNextPage }
        nodes {
          id title currentQuantity variantTitle
          variant { selectedOptions { name value } }
          product { title productType description(truncateAt: 400) }
        }
      }
    }
  }
}`


// ------------------------------------------------------------
// 5. Acceso a la base de datos
// ------------------------------------------------------------
export interface Configuracion {
  importarDesde: string // AAAA-MM-DD
  ultimaSincronizacion: string | null
}

export interface OrdenExistente {
  id: string
  shopify_order_id: string
  shopify_line_item_id: string
  unidad: number
  estado: string
  etapa_b: boolean
  etapa_i: boolean
  etapa_a: boolean
  etapa_c: boolean
  listo: boolean
  cancelado_en: string | null
}

export interface OrdenGuardada {
  id: string
  shopify_line_item_id: string
  unidad: number
}

export interface Almacen {
  /* Solo lectura (modo dry). */
  leerConfiguracion(): Promise<Configuracion>
  /* Toma la marca de "corrida en curso"; null si ya hay otra en marcha. */
  reservar(): Promise<Configuracion | null>
  existentes(pedidoIds: string[]): Promise<OrdenExistente[]>
  guardarOrdenes(filas: FilaOrden[]): Promise<OrdenGuardada[]>
  guardarClientes(filas: FilaCliente[]): Promise<void>
  marcarCanceladas(ids: string[], cuando: string): Promise<void>
  restaurar(ids: string[]): Promise<void>
  finalizar(ultima: string | null, ordenes: number, error: string | null): Promise<void>
}

const aConfiguracion = (r: { importar_desde: string; ultima_sincronizacion: string | null }): Configuracion => ({
  importarDesde: String(r.importar_desde).slice(0, 10),
  ultimaSincronizacion: r.ultima_sincronizacion,
})

const trozos = <T>(lista: T[], tamano: number) => {
  const r: T[][] = []
  for (let i = 0; i < lista.length; i += tamano) r.push(lista.slice(i, i + tamano))
  return r
}

/* Implementación con supabase-js y la clave de servicio. `admin` es el
   cliente creado con SUPABASE_SERVICE_ROLE_KEY. */
export function almacenSupabase(admin: any): Almacen { // eslint-disable-line @typescript-eslint/no-explicit-any
  const falla = (contexto: string, error: { message: string } | null) => {
    if (error) throw new Error(`${contexto}: ${error.message}`)
  }
  return {
    async leerConfiguracion() {
      const { data, error } = await admin.from('sync_shopify').select('importar_desde, ultima_sincronizacion').eq('id', true).single()
      falla('No se pudo leer sync_shopify', error)
      return aConfiguracion(data)
    },
    async reservar() {
      const { data, error } = await admin.rpc('reservar_sync_shopify')
      falla('No se pudo reservar la sincronización', error)
      const fila = Array.isArray(data) ? data[0] : data
      return fila ? aConfiguracion(fila) : null
    },
    async existentes(pedidoIds) {
      if (pedidoIds.length === 0) return []
      const { data, error } = await admin
        .from('ordenes_fabricacion')
        .select('id, shopify_order_id, shopify_line_item_id, unidad, estado, etapa_b, etapa_i, etapa_a, etapa_c, listo, cancelado_en')
        .in('shopify_order_id', pedidoIds)
      falla('No se pudieron leer las órdenes existentes', error)
      return (data ?? []) as OrdenExistente[]
    },
    async guardarOrdenes(filas) {
      const guardadas: OrdenGuardada[] = []
      for (const lote of trozos(filas, 200)) {
        const { data, error } = await admin
          .from('ordenes_fabricacion')
          .upsert(lote, { onConflict: 'shopify_line_item_id,unidad' })
          .select('id, shopify_line_item_id, unidad')
        falla('No se pudieron guardar las órdenes', error)
        guardadas.push(...((data ?? []) as OrdenGuardada[]))
      }
      return guardadas
    },
    async guardarClientes(filas) {
      for (const lote of trozos(filas, 200)) {
        const { error } = await admin.from('ordenes_fabricacion_cliente').upsert(lote, { onConflict: 'orden_id' })
        falla('No se pudieron guardar los datos de cliente', error)
      }
    },
    async marcarCanceladas(ids, cuando) {
      for (const lote of trozos(ids, 100)) {
        const { error } = await admin.from('ordenes_fabricacion').update({ cancelado_en: cuando }).in('id', lote)
        falla('No se pudieron marcar las órdenes canceladas', error)
      }
    },
    async restaurar(ids) {
      for (const lote of trozos(ids, 100)) {
        const { error } = await admin.from('ordenes_fabricacion').update({ cancelado_en: null }).in('id', lote)
        falla('No se pudieron restaurar las órdenes', error)
      }
    },
    async finalizar(ultima, ordenes, errorTexto) {
      const { error } = await admin.rpc('finalizar_sync_shopify', { p_ultima: ultima, p_ordenes: ordenes, p_error: errorTexto })
      falla('No se pudo registrar el cierre de la sincronización', error)
    },
  }
}


// ------------------------------------------------------------
// 6. La sincronización
// ------------------------------------------------------------
export interface OpcionesCorrida {
  dry: boolean
  /* En modo dry, incluir todas las filas mapeadas (sin datos personales). */
  filas: boolean
  /* AAAA-MM-DD: reprocesar desde esa fecha. */
  desde: string | null
}

export interface DepsCorrida {
  almacen: Almacen
  shopify: ClienteShopify
  ahora: () => Date
  limiteMs?: number
}

export interface ResultadoCorrida {
  ok: boolean
  /* Hay otra corrida en marcha: no se hizo nada. */
  enCurso: boolean
  dry: boolean
  /* Se cortó por tiempo antes de leer todo. */
  parcial: boolean
  desde: string | null
  hasta_donde_se_avanzo: string | null
  pedidos_leidos: number
  pedidos_anteriores_a_importar_desde: number
  pedidos_cancelados: number
  pedidos_sin_muebles: number
  ordenes: { nuevas: number; actualizadas: number; canceladas: number; restauradas: number }
  origenes: Record<string, number>
  revisar: { numero: string; motivos: string[] }[]
  advertencias: string[]
  errores: string[]
  filas?: Record<string, string | number | null>[]
}

const tieneAvance = (o: OrdenExistente) => o.estado !== 'por_fabricar' || o.etapa_b || o.etapa_i || o.etapa_a || o.etapa_c || o.listo
const clave = (lineaId: string, unidad: number) => `${lineaId}|${unidad}`

export async function sincronizar(opts: OpcionesCorrida, deps: DepsCorrida): Promise<ResultadoCorrida> {
  const { almacen, shopify } = deps
  const inicio = deps.ahora()
  const limite = deps.limiteMs ?? LIMITE_MS

  const r: ResultadoCorrida = {
    ok: true,
    enCurso: false,
    dry: opts.dry,
    parcial: false,
    desde: null,
    hasta_donde_se_avanzo: null,
    pedidos_leidos: 0,
    pedidos_anteriores_a_importar_desde: 0,
    pedidos_cancelados: 0,
    pedidos_sin_muebles: 0,
    ordenes: { nuevas: 0, actualizadas: 0, canceladas: 0, restauradas: 0 },
    origenes: {},
    revisar: [],
    advertencias: [],
    errores: [],
  }
  if (opts.dry && opts.filas) r.filas = []

  /* En modo dry no se reserva nada: solo se lee. */
  const config = opts.dry ? await almacen.leerConfiguracion() : await almacen.reservar()
  if (!config) {
    r.ok = false
    r.enCurso = true
    return r
  }

  let escritas = 0
  let avance: string | null = null
  let bloqueado = false // algún pedido falló: el punto de partida no puede pasar de ahí

  try {
    const limiteInferior = inicioDiaChile(config.importarDesde)
    let desde = config.ultimaSincronizacion ? new Date(new Date(config.ultimaSincronizacion).getTime() - SOLAPE_MS) : limiteInferior
    if (opts.desde) desde = inicioDiaChile(opts.desde)
    if (desde < limiteInferior) desde = limiteInferior
    r.desde = desde.toISOString()

    const q = `updated_at:>='${desde.toISOString()}'`
    let despues: string | null = null

    for (;;) {
      if (deps.ahora().getTime() - inicio.getTime() > limite) {
        r.parcial = true
        break
      }
      const datos = await shopify.consultar(QUERY_PEDIDOS, { q, after: despues })
      const pedidos = (datos.orders.nodes ?? []) as PedidoShopify[]
      r.pedidos_leidos += pedidos.length

      const paginaOk = await procesarPagina(pedidos)
      if (!paginaOk) {
        bloqueado = true
        break
      }
      if (!bloqueado && pedidos.length) avance = pedidos[pedidos.length - 1].updatedAt

      if (!datos.orders.pageInfo.hasNextPage) break
      despues = datos.orders.pageInfo.endCursor
    }
  } catch (err) {
    r.errores.push(err instanceof Error ? err.message : 'Error inesperado.')
    bloqueado = true
  }

  /* Hasta dónde se puede dar por sincronizado: toda la corrida si terminó
     sin problemas; si no, hasta el último pedido procesado antes del
     problema. */
  const completa = !bloqueado && !r.parcial
  const ultima = completa ? inicio.toISOString() : avance
  r.hasta_donde_se_avanzo = ultima
  r.ok = r.errores.length === 0

  if (!opts.dry) {
    const resumenErrores = r.errores.length ? r.errores.join(' | ').slice(0, 1000) : null
    await almacen.finalizar(ultima, escritas, resumenErrores)
  }
  return r

  /* ---- Procesa los pedidos de una página. Devuelve false si falló la base
     de datos (no tiene sentido seguir). ---- */
  async function procesarPagina(pedidos: PedidoShopify[]): Promise<boolean> {
    const enRango: PedidoShopify[] = []
    for (const p of pedidos) {
      if (fechaChile(p.createdAt) < config!.importarDesde) r.pedidos_anteriores_a_importar_desde++
      else enRango.push(p)
    }
    if (enRango.length === 0) return true

    let previas: OrdenExistente[]
    try {
      previas = await almacen.existentes(enRango.map((p) => p.id))
    } catch (err) {
      r.errores.push(err instanceof Error ? err.message : 'Error al leer las órdenes existentes.')
      return false
    }
    const previasPorPedido = new Map<string, OrdenExistente[]>()
    for (const o of previas) {
      const lista = previasPorPedido.get(o.shopify_order_id) ?? []
      lista.push(o)
      previasPorPedido.set(o.shopify_order_id, lista)
    }

    const paraGuardar: FilaOrden[] = []
    const clientePorPedido = new Map<string, DatosCliente>()
    const aCancelar: { ids: string[]; cuando: string }[] = []
    const aRestaurar: string[] = []
    let canceladasPagina = 0
    let restauradasPagina = 0

    for (const p of enRango) {
      try {
        if (p.lineItems.pageInfo?.hasNextPage) {
          throw new Error(`el pedido ${p.name} tiene más de ${LINEAS_POR_PEDIDO} líneas y no se pueden leer todas`)
        }
        const previasDelPedido = previasPorPedido.get(p.id) ?? []

        if (p.cancelledAt) {
          r.pedidos_cancelados++
          const vivas = previasDelPedido.filter((o) => o.cancelado_en === null)
          if (vivas.length) {
            aCancelar.push({ ids: vivas.map((o) => o.id), cuando: p.cancelledAt })
            canceladasPagina += vivas.length
            const conAvance = vivas.filter(tieneAvance).length
            if (conAvance) {
              r.advertencias.push(
                `Pedido ${p.name} cancelado en Shopify con ${conAvance} mueble(s) que ya tenían avance o despacho: se marcaron cancelados igual, revísalo.`,
              )
            }
          }
          continue
        }

        const mapeo = mapearPedido(p)
        if (mapeo.muebles.length === 0) {
          r.pedidos_sin_muebles++
          continue
        }

        const origen = p.sourceName || '(sin dato)'
        r.origenes[origen] = (r.origenes[origen] ?? 0) + 1

        const claves = new Set(mapeo.muebles.map((m) => clave(m.fila.shopify_line_item_id, m.fila.unidad)))
        const previasPorClave = new Map(previasDelPedido.map((o) => [clave(o.shopify_line_item_id, o.unidad), o]))

        for (const m of mapeo.muebles) {
          const previa = previasPorClave.get(clave(m.fila.shopify_line_item_id, m.fila.unidad))
          if (previa) {
            r.ordenes.actualizadas++
            if (previa.cancelado_en !== null) {
              aRestaurar.push(previa.id)
              restauradasPagina++
            }
          } else {
            r.ordenes.nuevas++
          }
          paraGuardar.push(m.fila)
          if (m.revisar.length) r.revisar.push({ numero: m.fila.numero, motivos: m.revisar })
          if (r.filas) {
            r.filas.push({
              numero: m.fila.numero,
              fecha: fechaChile(p.createdAt),
              tipo: m.fila.tipo,
              modelo: m.fila.modelo,
              orientacion: m.fila.orientacion,
              cm: m.fila.cm,
              color: m.fila.color,
              tela: m.fila.tela,
              comuna: m.fila.comuna,
              patas: m.fila.patas,
              origen_shopify: m.fila.origen_shopify,
            })
          }
        }
        clientePorPedido.set(p.id, mapeo.cliente)

        /* Unidades que estaban y ya no están (línea eliminada o con menos
           cantidad): se cancelan solo si no tienen avance. */
        const sobrantes = previasDelPedido.filter((o) => o.cancelado_en === null && !claves.has(clave(o.shopify_line_item_id, o.unidad)))
        const sinAvance = sobrantes.filter((o) => !tieneAvance(o))
        if (sinAvance.length) {
          aCancelar.push({ ids: sinAvance.map((o) => o.id), cuando: deps.ahora().toISOString() })
          canceladasPagina += sinAvance.length
        }
        const conAvance = sobrantes.length - sinAvance.length
        if (conAvance) {
          r.advertencias.push(
            `Pedido ${p.name}: ${conAvance} mueble(s) ya no figuran en Shopify (cantidad reducida o línea eliminada) pero tienen avance: no se cancelaron, revísalos.`,
          )
        }
      } catch (err) {
        r.errores.push(`Pedido ${p.name}: ${err instanceof Error ? err.message : 'error al mapear'}`)
        bloqueado = true
      }
    }

    r.ordenes.canceladas += canceladasPagina
    r.ordenes.restauradas += restauradasPagina
    if (opts.dry) return true

    try {
      if (paraGuardar.length) {
        const guardadas = await almacen.guardarOrdenes(paraGuardar)
        const idPorClave = new Map(guardadas.map((g) => [clave(g.shopify_line_item_id, g.unidad), g.id]))
        const ahoraIso = deps.ahora().toISOString()
        const filasCliente: FilaCliente[] = []
        for (const f of paraGuardar) {
          const id = idPorClave.get(clave(f.shopify_line_item_id, f.unidad))
          const datos = clientePorPedido.get(f.shopify_order_id)
          if (id && datos) filasCliente.push({ orden_id: id, ...datos, actualizado_en: ahoraIso })
        }
        await almacen.guardarClientes(filasCliente)
        escritas += paraGuardar.length
      }
      for (const grupo of aCancelar) await almacen.marcarCanceladas(grupo.ids, grupo.cuando)
      if (aRestaurar.length) await almacen.restaurar(aRestaurar)
    } catch (err) {
      r.errores.push(err instanceof Error ? err.message : 'Error al guardar en la base de datos.')
      return false
    }
    return true
  }
}


// ------------------------------------------------------------
// 7. Entrada HTTP: autenticación y parámetros
// ------------------------------------------------------------
/* Solo la app puede llamar a esta función desde un navegador (un
   administrador con su sesión). El cron no usa CORS. */
const ORIGENES_PERMITIDOS = [
  /^https:\/\/realzastock\.vercel\.app$/,
  /^https:\/\/realzastock-[a-z0-9-]+\.vercel\.app$/,
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/,
]

function corsPara(req: Request): Record<string, string> {
  const origen = req.headers.get('Origin') ?? ''
  const permitido = ORIGENES_PERMITIDOS.some((patron) => patron.test(origen))
  return {
    'Access-Control-Allow-Origin': permitido ? origen : 'https://realzastock.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

/* Comparación en tiempo constante: no revela, por el tiempo que tarda, cuántos
   caracteres del secreto se acertaron. */
export function secretosIguales(a: string, b: string) {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let dif = ea.length ^ eb.length
  const n = Math.max(ea.length, eb.length)
  for (let i = 0; i < n; i++) dif |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return dif === 0
}

/* "realza-hogar", "https://realza-hogar.myshopify.com/" -> "realza-hogar".
   Devuelve null si no parece un subdominio válido: así el token nunca viaja
   a un dominio inesperado. */
export function normalizarShop(valor: string | undefined) {
  if (!valor) return null
  const s = valor
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.myshopify\.com$/, '')
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(s) ? s : null
}

export type ResultadoVerificacion = 'administrador' | 'no_administrador' | 'sesion_invalida'

export interface DepsHttp {
  env: (nombre: string) => string | undefined
  verificarAdministrador: (token: string) => Promise<ResultadoVerificacion>
  crearAlmacen: () => Almacen
  crearShopify: (shop: string, token: string) => ClienteShopify
  ahora: () => Date
}

export async function manejar(req: Request, deps: DepsHttp): Promise<Response> {
  const cors = corsPara(req)
  const responder = (cuerpo: unknown, status = 200) =>
    new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return responder({ error: 'Usa POST.' }, 405)

  try {
    // ----------------------------------------------------------
    // 1) Autenticación: lo primero, antes de tocar Shopify o la base.
    // ----------------------------------------------------------
    const cabeceraCron = req.headers.get('x-cron-secret')
    let quien: 'cron' | 'administrador'
    if (cabeceraCron !== null) {
      const secreto = deps.env('CRON_SECRET')
      /* Un secreto ausente o corto cierra esta vía por completo. */
      if (!secreto || secreto.length < 32 || !secretosIguales(cabeceraCron, secreto)) {
        return responder({ error: 'Credencial inválida.' }, 401)
      }
      quien = 'cron'
    } else {
      const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
      if (!token) return responder({ error: 'Falta la autenticación.' }, 401)
      const verificacion = await deps.verificarAdministrador(token)
      if (verificacion === 'sesion_invalida') return responder({ error: 'Sesión inválida o expirada.' }, 401)
      if (verificacion !== 'administrador') return responder({ error: 'Solo un administrador puede sincronizar.' }, 403)
      quien = 'administrador'
    }

    // ----------------------------------------------------------
    // 2) Parámetros
    // ----------------------------------------------------------
    const url = new URL(req.url)
    const bandera = (nombre: string) => ['1', 'true', 'si'].includes((url.searchParams.get(nombre) ?? '').toLowerCase())
    const dry = bandera('dry')
    const filas = dry && bandera('filas')
    const desde = url.searchParams.get('desde')
    if (desde !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || Number.isNaN(Date.parse(desde)))) {
      return responder({ error: 'El parámetro "desde" debe ser una fecha AAAA-MM-DD.' }, 400)
    }

    // ----------------------------------------------------------
    // 3) Configuración de Shopify
    // ----------------------------------------------------------
    const shop = normalizarShop(deps.env('SHOPIFY_SHOP'))
    if (!shop) {
      return responder({ error: 'Falta o es inválido el secreto SHOPIFY_SHOP (solo el subdominio, por ejemplo "realza-hogar").' }, 500)
    }
    const tokenShopify = deps.env('SHOPIFY_ACCESS_TOKEN')
    if (!tokenShopify) return responder({ error: 'Falta el secreto SHOPIFY_ACCESS_TOKEN.' }, 500)

    // ----------------------------------------------------------
    // 4) Sincronizar
    // ----------------------------------------------------------
    const resultado = await sincronizar(
      { dry, filas, desde },
      { almacen: deps.crearAlmacen(), shopify: deps.crearShopify(shop, tokenShopify), ahora: deps.ahora },
    )

    /* Registro de la corrida: solo conteos, nunca datos personales. */
    console.log(
      JSON.stringify({
        evento: 'sincronizar-shopify',
        quien,
        dry,
        ok: resultado.ok,
        parcial: resultado.parcial,
        leidos: resultado.pedidos_leidos,
        ordenes: resultado.ordenes,
        errores: resultado.errores.length,
      }),
    )

    if (resultado.enCurso) {
      return responder({ ...resultado, mensaje: 'Ya hay una sincronización en curso.' }, 409)
    }
    return responder(resultado, resultado.ok ? 200 : 502)
  } catch (err) {
    if (err instanceof ErrorShopify) return responder({ error: err.message }, 502)
    return responder({ error: err instanceof Error ? err.message : 'Error inesperado.' }, 500)
  }
}


// ------------------------------------------------------------
// 8. Arranque en Supabase (Deno)
// ------------------------------------------------------------
// Fuera de Deno (las pruebas) este bloque no se ejecuta. El import es
// dinámico para que el archivo también se pueda cargar sin Deno.
declare const Deno: any // eslint-disable-line @typescript-eslint/no-explicit-any

if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  Deno.serve((req: Request) =>
    manejar(req, {
      env: (nombre) => Deno.env.get(nombre),
      /* Igual que en crear-usuario: el token se valida contra Supabase Auth y
         el rol se lee con los permisos de quien llama (RLS), no con la clave
         de servicio. */
      verificarAdministrador: async (token) => {
        const cliente = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false },
        })
        const {
          data: { user },
          error,
        } = await cliente.auth.getUser(token)
        if (error || !user) return 'sesion_invalida'
        const { data: fila, error: errorRol } = await cliente.from('usuarios').select('rol').eq('id', user.id).single()
        return !errorRol && fila?.rol === 'administrador' ? 'administrador' : 'no_administrador'
      },
      crearAlmacen: () => almacenSupabase(admin),
      crearShopify: (shop, token) => crearClienteShopify(shop, token, fetch),
      ahora: () => new Date(),
    }),
  )
}

// ============================================================
// Cómo desplegar esta función (Dashboard de Supabase, un solo archivo):
//   1. Ve a Edge Functions -> Secrets y crea SHOPIFY_SHOP,
//      SHOPIFY_ACCESS_TOKEN y CRON_SECRET (ver la lista arriba).
//   2. Edge Functions -> "Deploy a new function" -> nómbrala exactamente
//      "sincronizar-shopify" y pega TODO el contenido de este archivo.
//   3. Deploy.
//   4. IMPORTANTE: entra a la función -> Details/Settings y DESACTIVA
//      "Verify JWT" (Enforce JWT Verification). Sin eso, el cron (que no
//      lleva un JWT) recibe 401 de Supabase antes de llegar a la función.
//      La función se protege sola: CRON_SECRET o un administrador logueado.
// ============================================================
