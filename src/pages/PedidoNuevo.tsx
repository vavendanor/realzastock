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
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { clp } from '../lib/format'
import { listarVariantes } from '../lib/inventario'
import { crearPedido } from '../lib/pedidos'
import type { ProductoVariante } from '../types'

interface Linea {
  key: number
  varianteId: string
  cantidad: number
}

let siguienteKey = 1

export function PedidoNuevo() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()

  const [variantes, setVariantes] = useState<ProductoVariante[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteContacto, setClienteContacto] = useState('')
  const [direccionCalle, setDireccionCalle] = useState('')
  const [direccionComuna, setDireccionComuna] = useState('')
  const [direccionCiudad, setDireccionCiudad] = useState('')
  const [direccionRegion, setDireccionRegion] = useState('')
  const [direccionReferencia, setDireccionReferencia] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])

  useEffect(() => {
    const cargar = async () => {
      setCargando(true)
      setError(null)
      try {
        const datos = await listarVariantes()
        setVariantes(datos)
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

  /* Chequeo informativo en el cliente: la validación real (la que no se
     puede evadir) ocurre en la función crear_pedido del servidor. */
  const excesos = lineas.filter((linea) => {
    const variante = variantePorId.get(linea.varianteId)
    if (!variante) return false
    return linea.cantidad > variante.stockBodega + variante.stockShowroom
  })

  const total = lineas.reduce((suma, linea) => {
    const variante = variantePorId.get(linea.varianteId)
    return suma + (variante ? variante.precio * linea.cantidad : 0)
  }, 0)

  const puedeConfirmar =
    !cargando &&
    !guardando &&
    clienteNombre.trim() !== '' &&
    direccionCalle.trim() !== '' &&
    direccionComuna.trim() !== '' &&
    direccionCiudad.trim() !== '' &&
    direccionRegion.trim() !== '' &&
    lineas.length > 0 &&
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
          direccionCiudad,
          direccionRegion,
          direccionReferencia,
        },
        lineas.map((l) => ({ variante_id: l.varianteId, cantidad: l.cantidad })),
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
                  label="Contacto (opcional)"
                  size={esEscritorio ? 'md' : 'touch'}
                  value={clienteContacto}
                  onChange={(e) => setClienteContacto(e.target.value)}
                  placeholder="Teléfono o correo"
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
                <Input
                  label="Comuna"
                  required
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionComuna}
                  onChange={(e) => setDireccionComuna(e.target.value)}
                  placeholder="Providencia"
                />
                <Input
                  label="Ciudad"
                  required
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionCiudad}
                  onChange={(e) => setDireccionCiudad(e.target.value)}
                  placeholder="Santiago"
                />
                <Input
                  label="Región"
                  required
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionRegion}
                  onChange={(e) => setDireccionRegion(e.target.value)}
                  placeholder="Metropolitana"
                />
                <Input
                  label="Referencia (opcional)"
                  size={esEscritorio ? 'md' : 'touch'}
                  value={direccionReferencia}
                  onChange={(e) => setDireccionReferencia(e.target.value)}
                  placeholder="Edificio sin ascensor de carga"
                />
              </div>
            </Card>

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
          </div>

          <Card title="Resumen">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {lineas.map((linea) => {
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
                <span style={{ font: 'var(--type-label)', color: 'var(--text-strong)' }}>Total estimado</span>
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
                El pedido queda como "pendiente" y no descuenta stock todavía — eso ocurre recién cuando bodega lo
                despacha.
              </p>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  )
}
