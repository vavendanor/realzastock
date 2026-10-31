import { ArrowLeft, ArrowRight, Check, ClipboardList, FileDown, Mail, MapPin, Phone, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { ComprobanteDespacho } from '../components/ComprobanteDespacho'
import { Shell } from '../components/layout/Shell'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EstadoBadge } from '../components/ui/EstadoBadge'
import { Select } from '../components/ui/Select'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { imprimirConTitulo } from '../lib/comprobante'
import { clp, formatearTelefono } from '../lib/format'
import { avanzarEstadoPedido, ESTADO_LABEL, ESTADO_SIGUIENTE, obtenerPedido, ORDEN_ESTADOS } from '../lib/pedidos'
import type { Pedido, UbicacionStock } from '../types'

const UBICACIONES: { value: UbicacionStock; label: string }[] = [
  { value: 'bodega', label: 'Bodega' },
  { value: 'showroom', label: 'Showroom' },
]

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleString('es-CL')
}

export function PedidoDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()
  const { rol } = useAuth()

  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ubicacionDespacho, setUbicacionDespacho] = useState<UbicacionStock>('bodega')
  const [avanzando, setAvanzando] = useState(false)
  const [emitidoEn, setEmitidoEn] = useState(() => new Date().toISOString())

  const cargar = useCallback(async () => {
    if (!id) return
    setCargando(true)
    setError(null)
    try {
      setPedido(await obtenerPedido(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el pedido')
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /* Solo administrador y bodega pueden cambiar el estado — coincide con la
     política de RLS y con la validación de rol dentro de la función RPC.
     Un vendedor viendo su propio pedido ve el progreso, pero no el control. */
  const puedeAvanzar = rol === 'administrador' || rol === 'bodega'

  const avanzar = async () => {
    if (!pedido) return
    const siguiente = ESTADO_SIGUIENTE[pedido.estado]
    if (!siguiente) return

    setError(null)
    setAvanzando(true)
    try {
      /* Con venta no se pide ubicación: el stock ya se descontó al vender y
         el servidor no vuelve a descontarlo al despachar. */
      await avanzarEstadoPedido(
        pedido.id,
        siguiente === 'despachado' && !pedido.ventaId ? ubicacionDespacho : undefined,
      )
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar el estado')
    } finally {
      setAvanzando(false)
    }
  }

  if (cargando) {
    return (
      <Shell eyebrow="PEDIDO" title="Cargando...">
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando pedido...</span>
        </Card>
      </Shell>
    )
  }

  if (!pedido) {
    return (
      <Shell eyebrow="PEDIDO" title="No encontrado">
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            {error ?? 'No se encontró el pedido, o no tienes acceso a él.'}
          </span>
        </Card>
      </Shell>
    )
  }

  const siguiente = ESTADO_SIGUIENTE[pedido.estado]
  const indiceActual = ORDEN_ESTADOS.indexOf(pedido.estado)

  /* El comprobante es para bodega: lo ven administrador y bodega, y solo
     cuando el pedido ya salió (despachado o entregado), también los antiguos. */
  const puedeVerComprobante =
    puedeAvanzar && (pedido.estado === 'despachado' || pedido.estado === 'entregado')

  const descargarComprobante = () => {
    /* flushSync: la hora de emisión tiene que estar pintada ANTES de abrir
       el diálogo de impresión, y un setState normal se aplicaría después. */
    flushSync(() => setEmitidoEn(new Date().toISOString()))
    imprimirConTitulo(`Comprobante de despacho ${pedido.id.slice(0, 8).toUpperCase()}`)
  }

  const pasos = (
    <Card title="Estado del pedido" subtitle={`Ingresado el ${formatearFecha(pedido.fechaCreacion)}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', flexWrap: esEscritorio ? 'nowrap' : 'wrap' }}>
        {ORDEN_ESTADOS.map((estado, i) => {
          const hecho = indiceActual >= i
          return (
            <div key={estado} style={{ display: 'contents' }}>
              {i > 0 && esEscritorio && (
                <span style={{ flex: 1, height: 2, background: hecho ? 'var(--nogal-500)' : 'var(--border-default)' }} />
              )}
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 88 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: hecho ? 'var(--nogal-700)' : 'var(--surface-card)',
                    border: `1px solid ${hecho ? 'var(--nogal-700)' : 'var(--border-default)'}`,
                    color: hecho ? '#fff' : 'var(--text-faint)',
                  }}
                >
                  {hecho ? <Check size={13} /> : <span className="rh-num" style={{ font: '11px var(--font-mono)' }}>{i + 1}</span>}
                </span>
                <span style={{ font: 'var(--type-caption)', color: hecho ? 'var(--text-strong)' : 'var(--text-muted)' }}>
                  {ESTADO_LABEL[estado]}
                </span>
              </span>
            </div>
          )
        })}
      </div>

      {pedido.ventaId && (
        <p
          style={{
            font: 'var(--type-caption)',
            color: 'var(--text-body)',
            background: 'var(--arena-100)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
          }}
        >
          Este pedido nace de una venta: el stock ya se descontó al venderla, así que despacharlo no lo descuenta de
          nuevo. Los precios son los de la venta.
        </p>
      )}

      {!puedeAvanzar && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          Solo administración y bodega pueden cambiar el estado de un pedido.
        </p>
      )}

      {puedeAvanzar && !siguiente && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Este pedido ya fue entregado.</p>
      )}

      {puedeAvanzar && siguiente && (
        <div
          style={{
            display: 'flex',
            flexDirection: esEscritorio ? 'row' : 'column',
            alignItems: esEscritorio ? 'flex-end' : 'stretch',
            gap: 'var(--space-3)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--border-hairline)',
          }}
        >
          {siguiente === 'despachado' && !pedido.ventaId && (
            <Select
              label="Despachar desde"
              size={esEscritorio ? 'md' : 'touch'}
              value={ubicacionDespacho}
              onChange={(e) => setUbicacionDespacho(e.target.value as UbicacionStock)}
              options={UBICACIONES}
              wrapperStyle={esEscritorio ? { width: 200 } : undefined}
            />
          )}
          <Button
            size={esEscritorio ? 'md' : 'touch'}
            fullWidth={!esEscritorio}
            variant={pedido.estado === 'pendiente' ? 'primary' : 'accent'}
            iconLeft={<ArrowRight size={17} />}
            disabled={avanzando}
            onClick={() => void avanzar()}
          >
            {avanzando ? 'Actualizando...' : `Marcar ${ESTADO_LABEL[siguiente].toLowerCase()}`}
          </Button>
        </div>
      )}
    </Card>
  )

  const items = (
    <Card padding="0" title="Items">
      <div>
        {pedido.items.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-4)',
              padding: 'var(--space-4) var(--space-6)',
              borderTop: i ? '1px solid var(--border-hairline)' : 'none',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                {item.modelo} · {item.color}
              </div>
              <div style={{ font: 'var(--type-numeric)', fontSize: 'var(--text-body-xs)', color: 'var(--text-muted)' }}>
                {item.sku}
              </div>
            </div>
            <span className="rh-num" style={{ font: 'var(--type-numeric)', color: 'var(--text-muted)' }}>
              ×{item.cantidad}
            </span>
            <span className="rh-num" style={{ font: 'var(--type-numeric)', color: 'var(--text-strong)', minWidth: 96, textAlign: 'right' }}>
              {clp(item.precio * item.cantidad)}
            </span>
          </div>
        ))}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: 'var(--space-4) var(--space-6)',
            background: 'var(--arena-100)',
            borderTop: '1px solid var(--border-hairline)',
          }}
        >
          <span style={{ font: 'var(--type-label)', color: 'var(--text-strong)' }}>
            {pedido.ventaId ? 'Total de la venta' : 'Total del pedido'}
          </span>
          <span className="rh-num" style={{ font: 'var(--fw-medium) 22px/1 var(--font-display)', color: 'var(--text-strong)' }}>
            {clp(pedido.total)}
          </span>
        </div>
      </div>
    </Card>
  )

  const cliente = (
    <Card title="Cliente">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-body)' }}>
          <User size={16} color="var(--text-faint)" />
          <span>{pedido.clienteNombre}</span>
        </div>
        {pedido.clienteContacto && (
          <div style={{ display: 'flex', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-body)' }}>
            {/* Pedidos anteriores al cambio podían traer un correo como contacto. */}
            {pedido.clienteContacto.includes('@') ? (
              <Mail size={16} color="var(--text-faint)" />
            ) : (
              <Phone size={16} color="var(--text-faint)" />
            )}
            <span>{formatearTelefono(pedido.clienteContacto)}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-muted)' }}>
          <ClipboardList size={16} color="var(--text-faint)" />
          <span style={{ font: 'var(--type-caption)' }}>Registrado por {pedido.responsableNombre}</span>
        </div>
      </div>
    </Card>
  )

  const despacho = (
    <Card
      title="Despacho"
      actions={
        puedeVerComprobante ? (
          <Button size="sm" variant="secondary" iconLeft={<FileDown size={15} />} onClick={descargarComprobante}>
            Descargar comprobante
          </Button>
        ) : undefined
      }
    >
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <MapPin size={16} color="var(--text-faint)" style={{ flex: '0 0 auto', marginTop: 2 }} />
        <div style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>
          <div>{pedido.direccion.calle}</div>
          {/* La ciudad ya no se pide; solo la tienen los pedidos anteriores. */}
          <div>
            {pedido.direccion.comuna}
            {pedido.direccion.ciudad ? `, ${pedido.direccion.ciudad}` : ''}
          </div>
          <div>{pedido.direccion.region}</div>
        </div>
      </div>
      {pedido.direccion.referencia && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--state-warning-soft)',
            borderRadius: 'var(--radius-sm)',
            font: 'var(--type-body)',
            fontSize: 'var(--text-body-sm)',
            color: 'var(--tinta-700)',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4 }}>Referencia</strong>
          {pedido.direccion.referencia}
        </div>
      )}
    </Card>
  )

  return (
    <Shell
      eyebrow={`PEDIDO #${pedido.id.slice(0, 8).toUpperCase()}`}
      title={pedido.clienteNombre}
      actions={
        esEscritorio ? (
          <Button variant="secondary" iconLeft={<ArrowLeft size={16} />} onClick={() => navigate('/pedidos')}>
            Volver al listado
          </Button>
        ) : null
      }
    >
      {esEscritorio && (
        <Breadcrumb items={[{ label: 'Pedidos', to: '/pedidos' }, { label: `#${pedido.id.slice(0, 8).toUpperCase()}` }]} />
      )}

      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <EstadoBadge estado={pedido.estado} />
      </div>

      {esEscritorio ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr .8fr', gap: 'var(--space-5)', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {pasos}
            {items}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {cliente}
            {despacho}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {pasos}
          {cliente}
          {despacho}
          {items}
        </div>
      )}

      {puedeVerComprobante && <ComprobanteDespacho pedido={pedido} emitidoEn={emitidoEn} />}
    </Shell>
  )
}
