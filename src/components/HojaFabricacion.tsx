import { FileDown, Printer, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { exportarHojaFabricacionAExcel } from '../lib/exportarHojaFabricacion'
import { armarHojaFabricacion, faltaParaFabricar, nombreGrupo, tipoYOrientacion } from '../lib/hojaFabricacion'
import { formatearFechaHora } from '../lib/format'
import { formatearFechaPedido } from '../lib/ordenes'
import type { OrdenFabricacion } from '../types'
import { Button } from './ui/Button'

interface Props {
  ordenes: OrdenFabricacion[]
  /* Qué abarca la hoja ("Muebles por fabricar · pedidos del ... al ..." o
     "Selección de 5 muebles"). Se imprime en el encabezado. */
  alcance: string
  /* Nombre del archivo de Excel. */
  archivoExcel: string
  /* ISO del momento en que se abrió la hoja (la hora impresa es la de emisión). */
  emitidoEn: string
  onCerrar: () => void
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

const Cuadros = () => (
  <>
    {[0, 1, 2, 3].map((i) => (
      <td key={i} className="hf-cuadro">
        <span className="hf-caja" />
      </td>
    ))}
  </>
)

/* Hoja de fabricación para el taller: muebles por fabricar agrupados por
   modelo y tela, con cuadros vacíos para marcar B, I, A y C a mano, y los
   adicionales como sección aparte al final. SIN datos personales: solo la
   nota de producción.

   Se monta con un portal en <body>. En pantalla es la vista previa (barra con
   Imprimir y Excel); al imprimir se oculta la app entera y la barra, y queda
   solo la hoja en tamaño carta (ver styles/impresion.css). */
export function HojaFabricacion({ ordenes, alcance, archivoExcel, emitidoEn, onCerrar }: Props) {
  const hoja = useMemo(() => armarHojaFabricacion(ordenes), [ordenes])
  const [exportando, setExportando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  /* Mientras está abierta: la página de atrás no se desplaza, Escape cierra y el
     nombre del PDF al imprimir es el de la hoja. */
  useEffect(() => {
    const tituloAnterior = document.title
    const overflowAnterior = document.body.style.overflow
    document.title = archivoExcel.replace(/\.xlsx$/, '')
    document.body.style.overflow = 'hidden'
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.title = tituloAnterior
      document.body.style.overflow = overflowAnterior
      window.removeEventListener('keydown', alTeclear)
    }
  }, [archivoExcel, onCerrar])

  const excel = async () => {
    setExportando(true)
    setAviso(null)
    try {
      const r = await exportarHojaFabricacionAExcel(ordenes, archivoExcel)
      setAviso({ tipo: 'ok', texto: `Se descargó ${archivoExcel} (${plural(r.filas, 'fila', 'filas')}).` })
    } catch (err) {
      setAviso({ tipo: 'error', texto: err instanceof Error ? err.message : 'No se pudo generar el archivo.' })
    } finally {
      setExportando(false)
    }
  }

  const sinNada = hoja.totalMuebles === 0 && hoja.adicionales.length === 0

  return createPortal(
    <div className="hf-overlay" role="dialog" aria-modal="true" aria-label="Hoja de fabricación">
      <div className="hf-barra">
        <div className="hf-barra-texto">
          <strong>Hoja de fabricación</strong>
          {aviso && (
            <span role={aviso.tipo === 'error' ? 'alert' : 'status'} style={{ color: aviso.tipo === 'error' ? 'var(--state-danger)' : 'var(--state-success)' }}>
              {aviso.texto}
            </span>
          )}
        </div>
        <div className="hf-barra-botones">
          <Button size="sm" iconLeft={<Printer size={15} />} disabled={sinNada} onClick={() => window.print()}>
            Imprimir
          </Button>
          <Button size="sm" variant="secondary" iconLeft={<FileDown size={15} />} disabled={sinNada || exportando} onClick={() => void excel()}>
            {exportando ? 'Generando...' : 'Excel'}
          </Button>
          <Button size="sm" variant="ghost" iconLeft={<X size={15} />} onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      </div>

      <div className="hf-scroll">
        <article className="hf-papel">
          <header className="hf-encabezado">
            <div className="hf-marca">
              <img className="hf-logo" src="/pwa-512x512.png" alt="" />
              <span className="hf-marca-nombre">Realza Hogar</span>
            </div>
            <div className="hf-titulo-bloque">
              <h1 className="hf-titulo">Hoja de fabricación</h1>
              <div className="hf-meta">Emitida el {formatearFechaHora(emitidoEn)}</div>
            </div>
          </header>

          <p className="hf-alcance">{alcance}</p>
          <p className="hf-resumen">
            <strong>{plural(hoja.totalMuebles, 'mueble', 'muebles')}</strong>
            {hoja.modelos.length > 0 && <> · {hoja.modelos.map((g) => `${nombreGrupo(g.modelo, 'Sin modelo')} ${g.total}`).join(' · ')}</>}
            {hoja.adicionales.length > 0 && <> · {plural(hoja.adicionales.length, 'adicional', 'adicionales')} al final</>}
          </p>

          {sinNada && <p className="hf-vacio">No hay muebles para esta hoja.</p>}

          {hoja.modelos.map((g) => (
            <section key={g.modelo ?? '(sin modelo)'} className="hf-modelo">
              <h2 className="hf-h2">
                {nombreGrupo(g.modelo, 'SIN MODELO')} <span className="hf-cuenta">{plural(g.total, 'mueble', 'muebles')}</span>
              </h2>
              {g.telas.map((t) => (
                <div key={t.tela ?? '(sin tela)'} className="hf-tela-bloque">
                  <h3 className="hf-h3">
                    {nombreGrupo(t.tela, 'SIN TELA')} <span className="hf-cuenta">({t.muebles.length})</span>
                  </h3>
                  <table className="hf-tabla">
                    <thead>
                      <tr>
                        <th className="hf-c-num">N.°</th>
                        <th className="hf-c-tipo">Tipo</th>
                        <th className="hf-c-medida">Medida</th>
                        <th className="hf-c-color">Color</th>
                        <th className="hf-c-patas">Patas</th>
                        <th className="hf-c-notas">Notas de producción</th>
                        {['B', 'I', 'A', 'C'].map((e) => (
                          <th key={e} className="hf-c-etapa">
                            {e}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {t.muebles.map((o) => {
                        const falta = faltaParaFabricar(o)
                        const patasPropias = o.patas.trim().toUpperCase() !== 'PREDETERMINADAS'
                        return (
                          <tr key={o.id}>
                            <td className="hf-c-num">
                              <strong>{o.numero}</strong>
                              <span className="hf-sub">{formatearFechaPedido(o.fechaPedido)}</span>
                            </td>
                            <td className="hf-c-tipo">{tipoYOrientacion(o)}</td>
                            <td className="hf-c-medida">{o.cm ?? '—'}</td>
                            <td className="hf-c-color">{o.color ?? '—'}</td>
                            <td className={`hf-c-patas${patasPropias ? ' hf-fuerte' : ''}`}>{o.patas.toLowerCase()}</td>
                            <td className="hf-c-notas">
                              {falta && <strong className="hf-falta">{falta}. </strong>}
                              {o.notasProduccion}
                            </td>
                            <Cuadros />
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>
          ))}

          {hoja.adicionales.length > 0 && (
            <section className="hf-modelo hf-adicionales">
              <h2 className="hf-h2">
                Adicionales <span className="hf-cuenta">{plural(hoja.adicionales.length, 'ítem', 'ítems')} · patas, cojines y otros</span>
              </h2>
              <table className="hf-tabla">
                <thead>
                  <tr>
                    <th className="hf-c-num">N.°</th>
                    <th className="hf-c-desc">Descripción</th>
                    <th className="hf-c-notas">Notas de producción</th>
                    <th className="hf-c-listo">Listo</th>
                  </tr>
                </thead>
                <tbody>
                  {hoja.adicionales.map((o) => (
                    <tr key={o.id}>
                      <td className="hf-c-num">
                        <strong>{o.numero}</strong>
                        <span className="hf-sub">{formatearFechaPedido(o.fechaPedido)}</span>
                      </td>
                      <td className="hf-c-desc">{o.tituloShopify ?? o.tipo ?? '—'}</td>
                      <td className="hf-c-notas">{o.notasProduccion}</td>
                      <td className="hf-cuadro">
                        <span className="hf-caja" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </article>
      </div>
    </div>,
    document.body,
  )
}
