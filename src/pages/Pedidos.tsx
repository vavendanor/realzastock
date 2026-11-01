import { CirclePlus, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PedidosManuales } from '../components/PedidosManuales'
import { ProduccionLista } from '../components/ProduccionLista'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'

type Vista = 'produccion' | 'manuales'

const PESTAÑAS: { id: Vista; etiqueta: string }[] = [
  { id: 'produccion', etiqueta: 'Producción' },
  { id: 'manuales', etiqueta: 'Pedidos manuales' },
]

/* Administrador y bodega ven dos pestañas: Producción (las órdenes de
   fabricación que llegan de Shopify, primera) y Pedidos manuales (el flujo
   anterior). El vendedor no tiene acceso a producción: ve solo la lista de
   pedidos manuales, como siempre. */
export function Pedidos() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()
  const { rol } = useAuth()
  const [params, setParams] = useSearchParams()
  const [recargaToken, setRecargaToken] = useState(0)

  const veProduccion = rol === 'administrador' || rol === 'bodega'
  /* La pestaña vive en la URL: al recargar la página o volver desde un
     detalle se queda en la misma. */
  const vista: Vista = veProduccion && params.get('vista') !== 'manuales' ? 'produccion' : 'manuales'

  const elegir = (id: Vista) => {
    setParams(id === 'produccion' ? {} : { vista: id }, { replace: true })
  }

  return (
    <Shell
      eyebrow="OPERACIÓN"
      title="Pedidos"
      actions={
        <>
          <Button variant="secondary" iconLeft={<RotateCw size={15} />} onClick={() => setRecargaToken((n) => n + 1)}>
            {esEscritorio ? 'Recargar' : ''}
          </Button>
          {rol === 'vendedor' && (
            <Button iconLeft={<CirclePlus size={16} />} onClick={() => navigate('/pedidos/nuevo')}>
              {esEscritorio ? 'Nuevo pedido' : 'Nuevo'}
            </Button>
          )}
        </>
      }
    >
      {veProduccion && (
        <div
          role="tablist"
          aria-label="Tipo de pedidos"
          style={{ display: 'flex', gap: 'var(--space-2)', borderBottom: '1px solid var(--border-default)' }}
        >
          {PESTAÑAS.map((p) => {
            const activa = p.id === vista
            return (
              <button
                key={p.id}
                role="tab"
                type="button"
                aria-selected={activa}
                onClick={() => elegir(p.id)}
                style={{
                  flex: esEscritorio ? '0 0 auto' : 1,
                  minHeight: esEscritorio ? 40 : 46,
                  padding: esEscritorio ? '0 var(--space-5)' : '0 var(--space-2)',
                  whiteSpace: 'nowrap',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `3px solid ${activa ? 'var(--action-accent)' : 'transparent'}`,
                  marginBottom: -1,
                  font: 'var(--type-label)',
                  fontSize: 'var(--text-body-md)',
                  color: activa ? 'var(--text-strong)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {p.etiqueta}
              </button>
            )
          })}
        </div>
      )}

      {vista === 'produccion' ? <ProduccionLista recargaToken={recargaToken} /> : <PedidosManuales recargaToken={recargaToken} />}
    </Shell>
  )
}
