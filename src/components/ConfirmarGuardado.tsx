import { plural, type Resumen } from '../lib/cambiosPendientes'
import { ESTADO_ORDEN_LABEL } from '../lib/etiquetas'
import { Button } from './ui/Button'
import { Dialogo } from './ui/Dialogo'

interface Props {
  resumen: Resumen
  alCancelar: () => void
  alConfirmar: () => void
}

/* La segunda mirada antes de guardar: lista, mueble por mueble, qué casillas se
   marcan y cuáles se quitan, y qué estado resulta. Recién al confirmar se envía
   algo al servidor. */
export function ConfirmarGuardado({ resumen, alCancelar, alConfirmar }: Props) {
  return (
    <Dialogo
      titulo="Revisa antes de guardar"
      alCancelar={alCancelar}
      acciones={
        <>
          <Button variant="secondary" data-inicial onClick={alCancelar}>
            Volver
          </Button>
          <Button variant="primary" onClick={alConfirmar}>
            Guardar {plural(resumen.total, 'cambio', 'cambios')}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 var(--space-3)' }}>
        Vas a guardar <strong>{plural(resumen.total, 'cambio', 'cambios')}</strong> en <strong>{plural(resumen.muebles, 'mueble', 'muebles')}</strong>. Se aplican todos juntos.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {resumen.entradas.map((e) => {
          const quitaListo = e.cambioDeEstado?.a === 'por_fabricar'
          return (
            <li
              key={e.ordenId}
              data-orden={e.numero}
              style={{
                padding: 'var(--space-3)',
                border: `1px solid ${quitaListo ? 'var(--state-warning)' : 'var(--border-hairline)'}`,
                borderRadius: 'var(--radius-sm)',
                background: quitaListo ? 'var(--state-warning-soft)' : 'var(--surface-card)',
              }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2) var(--space-3)' }}>
                <strong className="rh-num" style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                  {e.numero}
                </strong>
                {e.cambios.map((c) => (
                  <span
                    key={c.etapa}
                    aria-label={`${c.etiqueta} ${c.valor ? 'se marca' : 'se quita'}`}
                    style={{
                      padding: '1px 8px',
                      borderRadius: 'var(--radius-pill)',
                      font: 'var(--fw-bold) var(--text-body-xs)/1.5 var(--font-sans)',
                      background: c.valor ? 'var(--state-success-soft)' : 'var(--state-danger-soft)',
                      color: c.valor ? 'var(--state-success)' : 'var(--state-danger)',
                    }}
                  >
                    {c.etiqueta} {c.valor ? '✔ se marca' : '✘ se quita'}
                  </span>
                ))}
              </div>
              {e.cambioDeEstado && (
                <div style={{ marginTop: 'var(--space-2)', font: 'var(--type-caption)', color: quitaListo ? 'var(--tinta-700)' : 'var(--text-muted)' }}>
                  {quitaListo ? 'Se quita LISTO: ' : 'Pasa de estado: '}
                  {ESTADO_ORDEN_LABEL[e.cambioDeEstado.de]} → {ESTADO_ORDEN_LABEL[e.cambioDeEstado.a]}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Dialogo>
  )
}
