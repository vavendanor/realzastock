import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { useCambiosPendientes } from '../hooks/useCambiosPendientes'
import { plural, textoBarra } from '../lib/cambiosPendientes'
import { esRutaDeProduccion } from './layout/navegacion'
import { Button } from './ui/Button'

/* Descartar pide confirmación solo si hay más de este número de cambios. */
const DESCARTE_SIN_CONFIRMAR = 3
const MS_AVISO_OK = 5000

/* Barra fija al pie de las pantallas de producción: cuántos cambios hay sin
   guardar y los botones para guardarlos o descartarlos. También muestra lo que
   no se pudo guardar, lo recuperado de una sesión anterior y el resultado del
   último guardado. */
export function BarraCambiosPendientes() {
  const { pathname } = useLocation()
  const esEscritorio = useEsEscritorio()
  const cp = useCambiosPendientes()
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)

  const { aviso, cerrarAviso, total } = cp
  useEffect(() => {
    if (aviso?.tipo !== 'ok') return
    const t = setTimeout(cerrarAviso, MS_AVISO_OK)
    return () => clearTimeout(t)
  }, [aviso, cerrarAviso])
  useEffect(() => {
    if (total === 0) setConfirmandoDescarte(false)
  }, [total])

  if (!esRutaDeProduccion(pathname) || (cp.total === 0 && !cp.aviso)) return null

  const tamano = esEscritorio ? 'md' : 'touch'
  const hayProblemas = cp.problemas.length > 0 || cp.noAplicables > 0

  const descartar = () => {
    if (cp.total > DESCARTE_SIN_CONFIRMAR) setConfirmandoDescarte(true)
    else cp.descartar()
  }

  return (
    <section
      aria-label="Cambios sin guardar"
      data-barra-cambios
      style={{
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--gutter-mobile)',
        background: 'var(--surface-card)',
        borderTop: cp.total > 0 ? '3px solid var(--action-accent)' : '1px solid var(--border-hairline)',
        boxShadow: '0 -4px 14px rgba(26,21,18,.08)',
      }}
    >
      {cp.restaurados > 0 && cp.total > 0 && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', font: 'var(--type-caption)', color: 'var(--text-body)' }}>
          <span>Recuperaste {plural(cp.restaurados, 'cambio', 'cambios')} sin guardar de una sesión anterior. Revísalos antes de guardar.</span>
          <Button size="sm" variant="ghost" onClick={cp.cerrarRestaurados}>
            Entendido
          </Button>
        </div>
      )}

      {hayProblemas && (
        <div role="alert" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--state-danger-soft)', color: 'var(--state-danger)', font: 'var(--type-caption)' }}>
          {cp.problemas.length > 0 ? (
            <>
              <strong>No se guardó nada.</strong> El servidor aplica todos los cambios juntos o ninguno, y estos no se pueden aplicar:
              <ul data-problemas style={{ margin: 'var(--space-2) 0', paddingLeft: 'var(--space-5)' }}>
                {cp.problemas.map((p) => (
                  <li key={`${p.orden_id}:${p.etapa}`}>{p.mensaje}</li>
                ))}
              </ul>
            </>
          ) : (
            <p style={{ margin: '0 0 var(--space-2)' }}>
              <strong>{plural(cp.noAplicables, 'cambio ya no se puede', 'cambios ya no se pueden')} guardar</strong> (el mueble salió a despacho o el pedido fue cancelado). Están marcados en rojo.
            </p>
          )}
          <Button size="sm" variant="secondary" onClick={cp.descartarProblemas} disabled={cp.guardando}>
            Descartar los que no se pueden aplicar
          </Button>
        </div>
      )}

      {cp.aviso && (
        <div
          role={cp.aviso.tipo === 'error' ? 'alert' : 'status'}
          data-aviso={cp.aviso.tipo}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            font: 'var(--type-body)',
            color: cp.aviso.tipo === 'ok' ? 'var(--state-success)' : 'var(--state-danger)',
          }}
        >
          <span>{cp.aviso.texto}</span>
          <button type="button" aria-label="Cerrar aviso" onClick={cp.cerrarAviso} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 4 }}>
            <X size={16} />
          </button>
        </div>
      )}

      {cp.total > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <span aria-live="polite" data-contador style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
            {cp.guardando ? 'Guardando...' : textoBarra(cp.total, cp.muebles)}
          </span>
          {confirmandoDescarte ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>¿Descartar los {cp.total} cambios?</span>
              <Button size={tamano} variant="danger" onClick={cp.descartar}>
                Sí, descartar
              </Button>
              <Button size={tamano} variant="secondary" onClick={() => setConfirmandoDescarte(false)}>
                No
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button size={tamano} variant="secondary" disabled={cp.guardando} onClick={descartar}>
                Descartar
              </Button>
              <Button size={tamano} variant="primary" disabled={cp.guardando} onClick={cp.abrirConfirmacion}>
                Revisar y guardar
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
