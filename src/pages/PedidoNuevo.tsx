import { Check, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { comunasDeRegion, REGIONES } from '../lib/chile'
import { clp, normalizarTelefono, telefonoValido } from '../lib/format'
import { listarVariantes } from '../lib/inventario'
import { crearPedido } from '../lib/pedidos'
import { listarVentasSinPedido } from '../lib/ventas'
import type { ProductoVariante, Venta } from '../types'

interface Linea {
  key: number
  varianteId: string
  cantidad: number
}

let siguienteKey = 1

function etiquetaVenta(venta: Venta, incluirVendedor: boolean) {
  const fecha = new Date(venta.fecha).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const primero = venta.items[0]
  const resto = venta.items.length - 1
  const productos = primero
    ? `${primero.cantidad} × ${primero.modelo}${resto > 0 ? ` +${resto} más` : ''}`
    : 'sin productos'
  return `${fecha} · ${productos} · ${clp(venta.total)}${incluirVendedor ? ` · ${venta.vendedorNombre}` : ''}`
}

export function PedidoNuevo() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()
  const { rol } = useAuth()

  const [variantes, setVariantes] = useState<ProductoVariante[]>([])
  const [ventasDisponibles, setVentasDisponibles] = useState<Venta[]>([])
  const [ventaId, setVentaId] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteContacto, setClienteContacto] = useState('')
  const [contactoTocado, setContactoTocado] = useState(false)
  const [direccionCalle, setDireccionCalle] = useState('')
  const [direccionRegion, setDireccionRegion] = useState('')
  const [direccionComuna, setDireccionComuna] = useState('')
  const [direccionReferencia, setDireccionReferencia] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])

  useEffect(() => {
    const cargar = async () => {
      setCargando(true)
      setError(null)
      try {
        const [datos, ventas] = await Promise.all([
          listarVariantes(),
          /* Si esta consulta falla, el pedido a mano sigue funcionando: el
             selector de ventas es una ayuda, no un requisito. */
          listarVentasSinPedido().catch(() => [] as Venta[]),
        ])
        setVariantes(datos)
        setVentasDisponibles(ventas)
        if (datos.length > 0) setLineas([{ key: siguienteKey++, varianteId: datos[0].id, cantidad: 1 }])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo')
      } finally {
        setCargando(false)
      }
    }
    void cargar()
  }, [])

  const variantePorId = useMemo(() => new Map(variantes.map((v) => [v.id, v])), [variantes])

  const agregarLinea = () => {
    if (variantes.length === 0) return
    setLineas((previas) => [...previas, { key: siguienteKey++, varianteId: variantes[0].id, cantidad: 1 }])
  }

  const quitarLinea = (key: number) => setLineas((previas) => previas.filter((l) => l.key !== key))

  const actualizarLinea = (key: number, cambios: Partial<Linea>) =>
    setLineas((previas) => previas.map((l) => (l.key === key ? { ...l, ...cambios } : l)))

  const venta = ventasDisponibles.find((v) => v.id === ventaId) ?? null

  const comunas = useMemo(() => comunasDeRegion(direccionRegion), [direccionRegion])

  /* El teléfono es opcional, pero si se escribe tiene que ser válido. El
     error no aparece mientras se tipea (marcaría "9" como inválido apenas
     se empieza): solo al salir del campo o al completar los 9 dígitos. */
  const contactoInvalido = clienteContacto !== '' && !telefonoValido(clienteContacto)
  const errorContacto =
    contactoInvalido && (contactoTocado || clienteContacto.length === 9)
      ? 'Ingresa 9 dígitos y que parta con 9 (ej: 912345678).'
      : undefined

  const cambiarRegion = (region: string) => {
    setDireccionRegion(region)
    /* La comuna elegida pertenecía a la región anterior. */
    setDireccionComuna('')
  }

  /* Chequeo informativo en el cliente: la validación real (la que no se
     puede evadir) ocurre en la función crear_pedido del servidor. Con una
     venta elegida no aplica: el stock ya se descontó al vender. */
  const excesos = venta
    ? []
    : lineas.filter((linea) => {
        const variante = variantePorId.get(linea.varianteId)
        if (!variante) return false
        return linea.cantidad > variante.stockBodega + variante.stockShowroom
      })

  /* Con venta, el total es el de la venta (precio al que se vendió); sin
     venta, es una estimación con el precio actual del catálogo. */
  const total = venta
    ? venta.total
    : lineas.reduce((suma, linea) => {
        const variante = variantePorId.get(linea.varianteId)
        return suma + (variante ? variante.precio * linea.cantidad : 0)
      }, 0)

  const puedeConfirmar =
    !cargando &&
    !guardando &&
    clienteNombre.trim() !== '' &&
    !contactoInvalido &&
    direccionCalle.trim() !== '' &&
    direccionRegion !== '' &&
    direccionComuna !== '' &&
    (venta !== null || lineas.length > 0) &&
    excesos.length === 0

  const confirmar = async () => {
    setError(null)
    setGuardando(true)
    try {
      await crearPedido(
        {
          clienteNombre,
          clienteContacto,
          direccionCalle,
          direccionComuna,
          direccionRegion,
          direccionReferencia,
        },
        /* Con venta, los productos los copia el servidor desde la venta. */
        venta ? [] : lineas.map((l) => ({ variante_id: l.varianteId, cantidad: l.cantidad })),
        venta?.id,
      )
      navigate('/pedidos')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el pedido')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Shell
      eyebrow="OPERACIÓN"
      title="Nuevo pedido"
      actions={
        esEscritorio ? (
          <Button variant="secondary" onClick={() => navigate('/pedidos')} disabled={guardando}>
            Cancelar
          </Button>
        ) : null
      }
    >
      {esEscritorio && <Breadcrumb items={[{ label: 'Pedidos', to: '/pedidos' }, { label: 'Nuevo pedido' }]} />}

      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      {cargando ? (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando catálogo...</span>
        </Card>
      ) : variantes.length === 0 ? (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>
            No hay productos en el catálogo todavía. Pídele a un administrador que cargue el inventario.
          </span>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: esEscritorio ? '1.2fr .8fr' : '1fr',
            gap: esEscritorio ? 'var(--space-5)' : 'var(--space-4)',
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {ventasDisponibles.length > 0 && (
              <Card title="Origen del pedido" subtitle="Ventas de los últimos 30 días que aún no tienen pedido">
                <Select
                  label="Basar en una venta"
                  size={esEscritorio ? 'md' : 'touch'}
                  value={ventaId}
                  onChange={(e) => setVentaId(e.target.value)}
                  options={[
                    { value: '', label: 'Ninguna: armar el pedido a mano' },
                    ...ventasDisponibles.map((v) => ({
                      value: v.id,
                      label: etiquetaVenta(v, rol === 'administrador'),
                    })),
                  ]}
                  hint={
                    venta
                      ? 'Los productos y cantidades salen de la venta, y el stock ya se descontó al venderla.'
                      : undefined
                  }
                />
              </Card>
            )}

            <Card title="Cliente">
              <div style={{ display: 'grid', gridTemplateColumns: esEscritorio ? '1fr 1fr' : '1fr', gap: 'var(--space-4)' }}>
                <Input
                  label="Nombre"
                  required
                  size={esEscritorio ? 'md' : 'touch'}
                  value={clienteNombre}
                  onChange={(e) => setClienteNombre(e.target.value)}
                  placeholder="Nombre y apellido"
                />
                <Input
                  label="Teléfono (opcional)"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={9}
                  size={esEscritorio ? 'md' : 'touch'}
                  iconLeft={<span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>+56</span>}
                  value={clienteContacto}
                  onChange={(e) => setClienteContacto(normalizarTelefono(e.target.value))}
                  onBlur={() => setContactoTocado(true)}
                  placeholder="912345678"
                  error={errorContacto}
                  hint={errorContacto ? undefined : 'Celular de 9 dígitos, parte con 9.'}
                />
              </div>
            </Card>

            <Card title="Dirección de despacho">
              <div style={{ display: 'grid', gridTemplateColumns: esEscritorio ? '1fr 1fr' : '1fr', gap: 'var(--space-4)' }}>
                <Input
                  label="Calle y número"
                  required
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionCalle}
                  onChange={(e) => setDireccionCalle(e.target.value)}
                  placeholder="Av. Los Leones 1420, dpto 703"
                  wrapperStyle={esEscritorio ? { gridColumn: 'span 2' } : undefined}
                />
                <Select
                  label="Región"
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionRegion}
                  onChange={(e) => cambiarRegion(e.target.value)}
                  options={[
                    { value: '', label: 'Selecciona una región' },
                    ...REGIONES.map((r) => ({ value: r.nombre, label: r.nombre })),
                  ]}
                />
                <Select
                  label="Comuna"
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionComuna}
                  onChange={(e) => setDireccionComuna(e.target.value)}
                  disabled={!direccionRegion}
                  options={[
                    { value: '', label: direccionRegion ? 'Selecciona una comuna' : 'Primero elige una región' },
                    ...comunas.map((c) => ({ value: c, label: c })),
                  ]}
                />
                <Input
                  label="Referencia (opcional)"
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionReferencia}
                  onChange={(e) => setDireccionReferencia(e.target.value)}
                  placeholder="Edificio sin ascensor de carga"
                  wrapperStyle={esEscritorio ? { gridColumn: 'span 2' } : undefined}
                />
              </div>
            </Card>

            {venta && (
              <Card title="Productos" subtitle="Tomados de la venta; no se pueden modificar acá">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {venta.items.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 'var(--space-3)',
                        paddingBottom: 'var(--space-3)',
                        borderBottom: i < venta.items.length - 1 ? '1px solid var(--border-hairline)' : 'none',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
                          {item.cantidad} × {item.modelo} · {item.color}
                        </div>
                        <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                          {item.material} · {item.sku}
                        </div>
                      </div>
                      <span className="rh-num" style={{ font: 'var(--type-numeric)', color: 'var(--text-strong)' }}>
                        {clp(item.cantidad * item.precioUnitario)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {!venta && (
            <Card
              title="Productos"
              actions={
                <IconButton label="Agregar línea" variant="outline" onClick={agregarLinea}>
                  <Plus size={16} />
                </IconButton>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {lineas.map((linea) => {
                  const variante = variantePorId.get(linea.varianteId)
                  const disponible = variante ? variante.stockBodega + variante.stockShowroom : 0
                  const excede = variante ? linea.cantidad > disponible : false

                  return (
                    <div
                      key={linea.key}
                      style={{
                        display: 'flex',
                        flexDirection: esEscritorio ? 'row' : 'column',
                        gap: 'var(--space-3)',
                        alignItems: esEscritorio ? 'flex-end' : 'stretch',
                        paddingBottom: 'var(--space-3)',
                        borderBottom: '1px solid var(--border-hairline)',
                      }}
                    >
                      <Select
                        label="Variante"
                        size={esEscritorio ? 'md' : 'touch'}
                        value={linea.varianteId}
                        onChange={(e) => actualizarLinea(linea.key, { varianteId: e.target.value })}
                        options={variantes.map((v) => ({ value: v.id, label: `${v.modelo} · ${v.material} · ${v.color}` }))}
                        wrapperStyle={{ flex: 1, minWidth: 0 }}
                      />
                      <Input
                        label="Cantidad"
                        type="number"
                        min={1}
                        size={esEscritorio ? 'md' : 'touch'}
                        value={linea.cantidad}
                        onChange={(e) => actualizarLinea(linea.key, { cantidad: Math.max(1, Number(e.target.value)) })}
                        wrapperStyle={{ width: esEscritorio ? 110 : undefined }}
                        error={excede ? `Solo hay ${disponible} en total` : undefined}
                      />
                      {lineas.length > 1 && (
                        <IconButton
                          label="Quitar línea"
                          variant="outline"
                          onClick={() => quitarLinea(linea.key)}
                          style={{ flex: '0 0 auto' }}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
            )}
          </div>

          <Card title="Resumen">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {venta
                ? venta.items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--type-body)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {item.cantidad} × {item.modelo}
                      </span>
                      <span className="rh-num" style={{ color: 'var(--text-strong)' }}>
                        {clp(item.cantidad * item.precioUnitario)}
                      </span>
                    </div>
                  ))
                : lineas.map((linea) => {
                    const variante = variantePorId.get(linea.varianteId)
                    if (!variante) return null
                    return (
                      <div key={linea.key} style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--type-body)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {linea.cantidad} × {variante.modelo}
                        </span>
                        <span className="rh-num" style={{ color: 'var(--text-strong)' }}>
                          {clp(variante.precio * linea.cantidad)}
                        </span>
                      </div>
                    )
                  })}

              <div
                style={{
                  borderTop: '1px solid var(--border-hairline)',
                  paddingTop: 'var(--space-3)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                }}
              >
                <span style={{ font: 'var(--type-label)', color: 'var(--text-strong)' }}>
                  {venta ? 'Total de la venta' : 'Total estimado'}
                </span>
                <span className="rh-num" style={{ font: 'var(--fw-medium) 28px/1 var(--font-display)', color: 'var(--text-strong)' }}>
                  {clp(total)}
                </span>
              </div>

              <Button
                size={esEscritorio ? 'lg' : 'touch'}
                variant="accent"
                fullWidth
                disabled={!puedeConfirmar}
                onClick={() => void confirmar()}
                iconLeft={<Check size={17} />}
              >
                {guardando ? 'Creando...' : 'Crear pedido'}
              </Button>

              <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                {venta
                  ? 'El pedido queda como "pendiente". El stock ya se descontó al registrar la venta, así que despacharlo no lo descuenta de nuevo.'
                  : 'El pedido queda como "pendiente" y no descuenta stock todavía — eso ocurre recién cuando bodega lo despacha.'}
              </p>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  )
}
