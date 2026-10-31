/* Lógica del Probador de colores: recolorea un mueble de una foto base
   usando su silueta (una imagen aparte, blanco = mueble).
   Portada de la herramienta original (index.html del probador); en esta
   versión las siluetas son fijas, así que no hay varita ni pincel. */

export interface ColorCatalogo {
  nombre: string
  hex: string
}

/* Catálogo de colores del probador. Es distinto de TAPICES (format.ts), que
   son los colores de tapiz de los productos del inventario. */
export const COLORES_PROBADOR: ColorCatalogo[] = [
  { nombre: 'Blanco hueso', hex: '#EDE6D6' },
  { nombre: 'Beige arena', hex: '#D2BE9D' },
  { nombre: 'Gris perla', hex: '#B8B8B4' },
  { nombre: 'Gris grafito', hex: '#4A4D52' },
  { nombre: 'Negro', hex: '#1E1E1E' },
  { nombre: 'Roble claro', hex: '#C8A26B' },
  { nombre: 'Nogal', hex: '#6B4423' },
  { nombre: 'Caoba', hex: '#5C2A1E' },
  { nombre: 'Terracota', hex: '#B5553A' },
  { nombre: 'Mostaza', hex: '#C9992E' },
  { nombre: 'Verde oliva', hex: '#6B6E3B' },
  { nombre: 'Verde botella', hex: '#2F5D50' },
  { nombre: 'Azul petróleo', hex: '#1F4E5F' },
  { nombre: 'Azul marino', hex: '#1E2A47' },
  { nombre: 'Rosa palo', hex: '#D8A7A0' },
  { nombre: 'Burdeo', hex: '#6E1F2B' },
]

export interface BaseMueble {
  id: string
  nombre: string
  foto: string
  silueta: string
}

/* Las fotos y siluetas viven en public/probador/. Si se reemplaza una foto,
   conviene cambiarle el nombre: el service worker las guarda en caché. */
export const BASES_PROBADOR: BaseMueble[] = [
  {
    id: 'cuero',
    nombre: 'Sofá de cuero',
    foto: '/probador/sofa-cuero.webp',
    silueta: '/probador/sofa-cuero.mask.png',
  },
  {
    id: 'tela',
    nombre: 'Sofá de tela',
    foto: '/probador/sofa-tela.webp',
    silueta: '/probador/sofa-tela.mask.png',
  },
]

/* Lado máximo de trabajo. Las fotos ya miden 1600, que es también el tamaño
   de la imagen que se descarga. */
const LADO_MAXIMO = 1600

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexARgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 }
}

/* Una foto lista para recolorear. Como la silueta no cambia, solo se guardan
   los píxeles que el recoloreado puede tocar (el mueble y su borde suavizado):
   así cada repintado recorre una fracción de la imagen y no sus 2,5 millones
   de píxeles. */
export interface Escena {
  ancho: number
  alto: number
  /* Píxeles originales (RGBA), sin recolorear. */
  original: Uint8ClampedArray
  /* Lo que se dibuja en el lienzo; `pintar` lo actualiza. */
  salida: ImageData
  /* Por cada píxel tocable: su posición, cuánto se mezcla el color nuevo
     (0-255, es la silueta con el borde suavizado) y su luminosidad (0-1). */
  indices: Int32Array
  peso: Uint8Array
  luminosidad: Float32Array
  /* Luminosidad media del mueble: el color elegido queda exacto en ese punto. */
  luminosidadMedia: number
}

const cargarImagen = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`No se pudo cargar ${src}`))
    img.src = src
  })

export async function cargarEscena(base: BaseMueble): Promise<Escena> {
  const [foto, silueta] = await Promise.all([cargarImagen(base.foto), cargarImagen(base.silueta)])

  const k = Math.min(1, LADO_MAXIMO / Math.max(foto.naturalWidth, foto.naturalHeight))
  const ancho = Math.round(foto.naturalWidth * k)
  const alto = Math.round(foto.naturalHeight * k)
  const n = ancho * alto

  /* Un lienzo aparte para leer píxeles: el que se ve en pantalla es otro. */
  const lienzo = document.createElement('canvas')
  lienzo.width = ancho
  lienzo.height = alto
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('El navegador no permite procesar la imagen')

  ctx.drawImage(foto, 0, 0, ancho, alto)
  const original = new Uint8ClampedArray(ctx.getImageData(0, 0, ancho, alto).data)

  ctx.clearRect(0, 0, ancho, alto)
  ctx.drawImage(silueta, 0, 0, ancho, alto)
  const datosSilueta = ctx.getImageData(0, 0, ancho, alto).data

  /* En la silueta, el mueble es lo que no es negro (se mira el canal rojo). */
  const mascara = new Uint8Array(n)
  for (let i = 0; i < n; i++) mascara[i] = datosSilueta[i * 4] > 127 ? 255 : 0

  /* Suaviza el borde: promedio de 3 píxeles en horizontal y luego en vertical,
     para que el color nuevo se funda con la foto y no deje un contorno duro. */
  const tmp = new Uint8Array(n)
  const suave = new Uint8Array(n)
  for (let y = 0, i = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++, i++)
      tmp[i] = (mascara[x ? i - 1 : i] + mascara[i] + mascara[x < ancho - 1 ? i + 1 : i]) / 3
  for (let y = 0, i = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++, i++)
      suave[i] = (tmp[y ? i - ancho : i] + tmp[i] + tmp[y < alto - 1 ? i + ancho : i]) / 3

  /* `fround`: la luminosidad se guarda en 32 bits (Float32Array), y la media se
     calcula con esos mismos valores, igual que la herramienta original; así el
     resultado coincide píxel a píxel. */
  const luminosidadDe = (i: number) =>
    Math.fround((0.299 * original[i * 4] + 0.587 * original[i * 4 + 1] + 0.114 * original[i * 4 + 2]) / 255)

  let suma = 0
  let enMueble = 0
  let tocables = 0
  for (let i = 0; i < n; i++) {
    if (mascara[i]) {
      suma += luminosidadDe(i)
      enMueble++
    }
    if (suave[i]) tocables++
  }
  if (!enMueble) throw new Error('La silueta del mueble está vacía')

  const indices = new Int32Array(tocables)
  const peso = new Uint8Array(tocables)
  const luminosidad = new Float32Array(tocables)
  for (let i = 0, k2 = 0; i < n; i++) {
    if (!suave[i]) continue
    indices[k2] = i
    peso[k2] = suave[i]
    luminosidad[k2] = luminosidadDe(i)
    k2++
  }

  /* Se evitan los extremos: con una media de 0 o 1 la división de `pintar`
     se dispara. */
  const luminosidadMedia = Math.min(0.97, Math.max(0.03, suma / enMueble))

  return {
    ancho,
    alto,
    original,
    salida: new ImageData(new Uint8ClampedArray(original), ancho, alto),
    indices,
    peso,
    luminosidad,
    luminosidadMedia,
  }
}

/* Recolorea `escena.salida`. El color elegido queda exacto en la luminosidad
   media del mueble; las sombras y luces de la foto se conservan oscureciendo
   o aclarando a partir de ese punto. `sombras` va de 0 (color plano) a 1
   (todo el relieve de la foto). Con `mostrarOriginal` devuelve la foto tal cual. */
export function pintar(escena: Escena, color: Rgb, sombras: number, mostrarOriginal: boolean) {
  const { original, salida, indices, peso, luminosidad, luminosidadMedia: m } = escena
  const out = salida.data

  if (mostrarOriginal) {
    for (let k = 0; k < indices.length; k++) {
      const p = indices[k] * 4
      out[p] = original[p]
      out[p + 1] = original[p + 1]
      out[p + 2] = original[p + 2]
    }
    return
  }

  const { r: tr, g: tg, b: tb } = color
  for (let k = 0; k < indices.length; k++) {
    const L = luminosidad[k]
    let r: number
    let g: number
    let b: number
    if (L <= m) {
      const f = 1 + (L / m - 1) * sombras
      r = tr * f
      g = tg * f
      b = tb * f
    } else {
      const t = ((L - m) / (1 - m)) * sombras * 0.7
      r = tr + (255 - tr) * t
      g = tg + (255 - tg) * t
      b = tb + (255 - tb) * t
    }
    const w = peso[k] / 255
    const p = indices[k] * 4
    out[p] = original[p] + (r - original[p]) * w
    out[p + 1] = original[p + 1] + (g - original[p + 1]) * w
    out[p + 2] = original[p + 2] + (b - original[p + 2]) * w
  }
}

export const slug = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/* En un teléfono o tablet (puntero táctil) y con soporte para compartir
   archivos, "descargar" abre el menú de compartir del sistema, que es lo que
   funciona dentro de la app Android. En un computador sería un estorbo: aunque
   el navegador también sepa compartir, ahí se espera un archivo descargado. */
export function puedeCompartirArchivos() {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false
  if (!window.matchMedia('(pointer: coarse)').matches) return false
  try {
    return navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

export type ResultadoExportacion = 'compartido' | 'descargado' | 'cancelado'

export async function exportarImagen(
  lienzo: HTMLCanvasElement,
  nombreArchivo: string,
  titulo: string,
): Promise<ResultadoExportacion> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    lienzo.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png'),
  )

  if (puedeCompartirArchivos()) {
    const archivo = new File([blob], nombreArchivo, { type: 'image/png' })
    try {
      await navigator.share({ files: [archivo], title: titulo })
      return 'compartido'
    } catch (err) {
      /* Cerrar el menú sin elegir nada no es un error. Cualquier otro fallo
         cae a la descarga normal. */
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelado'
    }
  }

  const enlace = document.createElement('a')
  enlace.href = URL.createObjectURL(blob)
  enlace.download = nombreArchivo
  document.body.append(enlace)
  enlace.click()
  enlace.remove()
  setTimeout(() => URL.revokeObjectURL(enlace.href), 1000)
  return 'descargado'
}
