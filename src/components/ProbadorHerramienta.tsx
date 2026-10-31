import { Download, Eye, Share2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import {
  BASES_PROBADOR,
  cargarEscena,
  COLORES_PROBADOR,
  exportarImagen,
  hexARgb,
  pintar,
  puedeCompartirArchivos,
  slug,
  type Escena,
} from '../lib/probador'
import { Button } from './ui/Button'
import { Card } from './ui/Card'

/* Verde botella: el color con el que partía la herramienta original. */
const COLOR_INICIAL = '#2F5D50'

interface Carga {
  clave: string
  escena: Escena | null
  error: boolean
}

/* Evita que mantener el dedo apretado abra el menú contextual o seleccione
   texto: el botón "Mantener para ver original" depende de eso. */
const SIN_SELECCION: CSSProperties = {
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
}

export function ProbadorHerramienta() {
  const esEscritorio = useEsEscritorio()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [baseId, setBaseId] = useState(BASES_PROBADOR[0].id)
  const [colorHex, setColorHex] = useState(COLOR_INICIAL)
  const [sombras, setSombras] = useState(100)
  const [viendoOriginal, setViendoOriginal] = useState(false)
  const [intento, setIntento] = useState(0)
  const [carga, setCarga] = useState<Carga | null>(null)
  const [exportando, setExportando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const base = BASES_PROBADOR.find((b) => b.id === baseId) ?? BASES_PROBADOR[0]
  const color = COLORES_PROBADOR.find((c) => c.hex === colorHex) ?? COLORES_PROBADOR[0]
  const usaCompartir = puedeCompartirArchivos()

  /* `carga` guarda a qué foto pertenece; mientras no coincida con la elegida
     ahora, se está cargando. Así no hay que "apagar" estados dentro del efecto. */
  const clave = `${baseId}:${intento}`
  const cargando = carga?.clave !== clave
  const escena = !cargando && carga ? carga.escena : null
  const huboError = !cargando && carga?.error === true

  useEffect(() => {
    let vigente = true
    cargarEscena(base)
      .then((e) => vigente && setCarga({ clave, escena: e, error: false }))
      .catch(() => vigente && setCarga({ clave, escena: null, error: true }))
    return () => {
      vigente = false
    }
  }, [base, clave])

  /* Repinta cuando cambia cualquier ajuste. Se agrupa en un fotograma para que
     arrastrar el deslizador no encole un repintado por cada movimiento. */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !escena) return
    const id = requestAnimationFrame(() => {
      if (canvas.width !== escena.ancho || canvas.height !== escena.alto) {
        canvas.width = escena.ancho
        canvas.height = escena.alto
      }
      pintar(escena, hexARgb(colorHex), sombras / 100, viendoOriginal)
      canvas.getContext('2d')?.putImageData(escena.salida, 0, 0)
    })
    return () => cancelAnimationFrame(id)
  }, [escena, colorHex, sombras, viendoOriginal])

  const mantenerOriginal = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      /* Captura el puntero: si el dedo o el mouse se deslizan fuera del botón
         sin soltar, igual se recibe el "soltar". Algunos navegadores lo
         rechazan en ciertos casos; sin captura igual funciona. */
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* sin captura */
      }
      setViendoOriginal(true)
    },
    onPointerUp: () => setViendoOriginal(false),
    onPointerCancel: () => setViendoOriginal(false),
    onLostPointerCapture: () => setViendoOriginal(false),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setViendoOriginal(true)
      }
    },
    onKeyUp: () => setViendoOriginal(false),
    onBlur: () => setViendoOriginal(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }

  const exportar = async () => {
    const canvas = canvasRef.current
    if (!canvas || !escena) return
    setExportando(true)
    setAviso(null)
    try {
      /* Siempre se exporta recoloreada, aunque se esté apretando "original". */
      pintar(escena, hexARgb(colorHex), sombras / 100, false)
      canvas.getContext('2d')?.putImageData(escena.salida, 0, 0)
      const resultado = await exportarImagen(
        canvas,
        `mueble-${slug(color.nombre)}-${colorHex.slice(1).toUpperCase()}.png`,
        `${base.nombre} · ${color.nombre}`,
      )
      if (resultado === 'descargado') setAviso('Imagen descargada.')
    } catch {
      setAviso('No se pudo generar la imagen. Inténtalo de nuevo.')
    } finally {
      setExportando(false)
    }
  }

  /* ---------- piezas ---------- */

  const alturaMaxima = esEscritorio ? 'calc(100svh - 290px)' : '32svh'

  const vistaPrevia = (
    <Card
      padding="var(--space-3)"
      style={esEscritorio ? undefined : { position: 'sticky', top: 0, zIndex: 5 }}
    >
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: esEscritorio ? 320 : 200,
          background: 'var(--arena-100)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${base.nombre} en ${color.nombre}`}
          style={{
            display: escena ? 'block' : 'none',
            maxWidth: '100%',
            maxHeight: alturaMaxima,
            width: 'auto',
            height: 'auto',
            borderRadius: 'var(--radius-sm)',
          }}
        />
        {cargando && (
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando foto…</span>
        )}
        {huboError && (
          <div style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
            <p style={{ font: 'var(--type-body)', color: 'var(--state-danger)', marginBottom: 'var(--space-3)' }}>
              No se pudo cargar la foto del mueble. Revisa tu conexión.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setIntento((n) => n + 1)}>
              Reintentar
            </Button>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: esEscritorio ? 'row' : 'column',
          alignItems: esEscritorio ? 'center' : 'stretch',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-3)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              font: 'var(--type-body-strong)',
              color: 'var(--text-strong)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {color.nombre}
          </div>
          <div style={{ font: 'var(--type-numeric)', fontSize: 'var(--text-body-xs)', color: 'var(--text-muted)' }}>
            {colorHex}
          </div>
        </div>
        <Button
          variant="secondary"
          size={esEscritorio ? 'md' : 'touch'}
          iconLeft={<Eye size={16} />}
          disabled={!escena}
          aria-pressed={viendoOriginal}
          style={esEscritorio ? SIN_SELECCION : { ...SIN_SELECCION, width: '100%' }}
          {...mantenerOriginal}
        >
          Mantener para ver original
        </Button>
      </div>
    </Card>
  )

  const selectorMueble = (
    <Card title="Mueble">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        {BASES_PROBADOR.map((b) => {
          const elegido = b.id === baseId
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={elegido}
              onClick={() => setBaseId(b.id)}
              style={{
                padding: 0,
                overflow: 'hidden',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'var(--surface-card)',
                borderRadius: 'var(--radius-md)',
                border: elegido ? '2px solid var(--action-accent)' : '1px solid var(--border-default)',
              }}
            >
              <img
                src={b.foto}
                alt=""
                loading="lazy"
                style={{ display: 'block', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover' }}
              />
              <span style={{ display: 'block', padding: 'var(--space-2) var(--space-3)', font: 'var(--type-label)' }}>
                {b.nombre}
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )

  const selectorColor = (
    <Card title="Color" subtitle="Catálogo de 16 colores">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)' }}>
        {COLORES_PROBADOR.map((c) => {
          const elegido = c.hex === colorHex
          return (
            <button
              key={c.hex}
              type="button"
              title={`${c.nombre} ${c.hex}`}
              aria-label={`${c.nombre} ${c.hex}`}
              aria-pressed={elegido}
              onClick={() => setColorHex(c.hex)}
              style={{
                padding: 0,
                overflow: 'hidden',
                cursor: 'pointer',
                textAlign: 'left',
                background: 'var(--surface-card)',
                borderRadius: 'var(--radius-md)',
                border: elegido ? '2px solid var(--action-accent)' : '1px solid var(--border-default)',
              }}
            >
              <i style={{ display: 'block', height: 38, background: c.hex }} />
              <span
                style={{
                  display: 'block',
                  padding: '4px 6px 6px',
                  font: 'var(--type-caption)',
                  color: 'var(--text-body)',
                  overflowWrap: 'anywhere',
                  /* En el celular los nombres largos pasan a dos líneas; todas las
                     casillas miden lo mismo para que la cuadrícula quede pareja. */
                  minHeight: esEscritorio ? undefined : '2.6em',
                }}
              >
                {c.nombre}
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )

  const ajusteSombras = (
    <Card title="Sombras">
      <label style={{ display: 'grid', gridTemplateColumns: '1fr 44px', gap: 'var(--space-3)', alignItems: 'center' }}>
        <input
          type="range"
          min={0}
          max={100}
          value={sombras}
          onChange={(e) => setSombras(Number(e.target.value))}
          aria-label="Intensidad de las sombras"
          style={{ width: '100%', accentColor: 'var(--action-accent)', height: 32 }}
        />
        <output className="rh-num" style={{ textAlign: 'right', font: 'var(--type-numeric)' }}>
          {sombras}
        </output>
      </label>
      <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
        Al máximo se conservan los pliegues y volúmenes de la foto; en 0 el color queda plano.
      </p>
    </Card>
  )

  const acciones = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <Button
        variant="accent"
        size={esEscritorio ? 'lg' : 'touch'}
        fullWidth
        disabled={!escena || exportando}
        iconLeft={usaCompartir ? <Share2 size={17} /> : <Download size={17} />}
        onClick={() => void exportar()}
      >
        {exportando ? 'Preparando…' : usaCompartir ? 'Guardar o compartir imagen' : 'Descargar imagen'}
      </Button>
      {aviso && (
        <p role="status" style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          {aviso}
        </p>
      )}
    </div>
  )

  if (esEscritorio) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.5fr) minmax(300px, 1fr)',
          gap: 'var(--space-5)',
          alignItems: 'start',
        }}
      >
        {vistaPrevia}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {selectorMueble}
          {selectorColor}
          {ajusteSombras}
          {acciones}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {vistaPrevia}
      {selectorMueble}
      {selectorColor}
      {ajusteSombras}
      {acciones}
    </div>
  )
}
