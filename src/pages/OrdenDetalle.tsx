import { ArrowLeft, ArrowRight, ClipboardList, FileDown, MapPin, Phone, TriangleAlert, User } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CasillaEtapa } from '../components/CasillaEtapa'
import { ComprobanteDespacho } from '../components/ComprobanteDespacho'
import { Shell } from '../components/layout/Shell'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EstadoOrdenBadge } from '../components/ui/EstadoOrdenBadge'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { faltaColorTela, mencionaPatas, preparadoPorShopify, shopifyDesmarco } from '../lib/avisosOrden'
import { imprimirConTitulo } from '../lib/comprobante'
import { formatearFechaHora, formatearTelefono, normalizarTelefono, telefonoValido } from '../lib/format'
import {
  aplicarEtapaLocal,
  avanzarEstadoOrden,
  ESTADO_ORDEN_LABEL,
  ESTADO_ORDEN_SIGUIENTE,
  etapaMarcada,
  etapasBloqueadas,
  ETAPAS,
  formatearFechaPedido,
  marcarEtapa,
  obtenerOrden,
  ORIGEN_LABEL,
  type OrdenCompleta,
} from '../lib/ordenes'
import type { Etapa } from '../types'

const mensajeError = (err: unknown, porDefecto: string) => (err instanceof Error ? err.message : porDefecto)

/* Detalle de una orden de fabricación. Solo administrador y bodega llegan
   hasta aquí (ruta protegida y política de la base de datos): por eso es
   el único lugar donde se piden los datos personales del cliente. */
export function OrdenDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()

  const [datos, setDatos] = useState<OrdenCompleta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [emitidoEn, setEmitidoEn] = useState(() => new Date().toISOString())

  const cargar = useCallback(async () => {
    if (!id) return
    setCargando(true)
    setError(null)
    try {
      setDatos(await obtenerOrden(id))
    } catch (err) {
      setError(mensajeError(err, 'No se pudo cargar la orden'))
    } finally {
      setCargando(false)
    }
  }, [id])

  useEffect(() => {
    void cargar()
  }, [cargar])

  if (cargando) {
    return (
      <Shell eyebrow="ORDEN DE FABRICACIÓN" title="Cargando...">
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando orden...</span>
        </Card>
      </Shell>
    )
  }

  if (!datos) {
    return (
      <Shell eyebrow="ORDEN DE FABRICACIÓN" title="No encontrada">
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            {error ?? 'No se encontró la orden, o no tienes acceso a ella.'}
          </span>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button variant="secondary" iconLeft={<ArrowLeft size={16} />} onClick={() => navigate('/pedidos')}>
              Volver a Pedidos
            </Button>
          </div>
        </Card>
      </Shell>
    )
  }

  const { orden, hermanas, cliente } = datos
  const cancelada = orden.canceladoEn !== null
  const bloqueada = etapasBloqueadas(orden)
  const siguiente = ESTADO_ORDEN_SIGUIENTE[orden.estado]
  const faltante = faltaColorTela(orden)
  const patasEnNota = mencionaPatas(orden)
  const desmarcadoEnShopify = shopifyDesmarco(orden)

  /* El comprobante es por pedido: lista los muebles del pedido que salen a
     despacho (en despacho o entregados). Se ofrece cuando esta orden ya salió. */
  const salenADespacho = (o: { estado: string; canceladoEn: string | null }) =>
    o.canceladoEn === null && (o.estado === 'en_despacho' || o.estado === 'entregado')
  const mueblesDelDespacho = [orden, ...hermanas]
    .filter(salenADespacho)
    .sort((a, b) => a.numero.localeCompare(b.numero, 'es', { numeric: true }))
  const puedeVerComprobante = salenADespacho(orden)

  const descargarComprobante = () => {
    /* flushSync: la hora de emisión tiene que estar pintada ANTES de abrir el
       diálogo de impresión, y un setState normal se aplicaría después. */
    flushSync(() => setEmitidoEn(new Date().toISOString()))
    imprimirConTitulo(`Comprobante de despacho ${orden.pedidoNumero}`)
  }

  const telefonoLegible = (valor: string) => {
    const digitos = normalizarTelefono(valor)
    return telefonoValido(digitos) ? formatearTelefono(digitos) : valor
  }

  const cambiarEtapa = async (etapa: Etapa, valor: boolean) => {
    if (etapa === 'listo' && !valor && !window.confirm(`¿Quitar LISTO de ${orden.numero}? Volverá a "Por fabricar".`)) return
    setError(null)
    setGuardando(true)
    const previa = datos
    setDatos({ ...datos, orden: aplicarEtapaLocal(orden, etapa, valor) })
    try {
      const actualizada = await marcarEtapa(orden.id, etapa, valor)
      setDatos((d) => (d ? { ...d, orden: actualizada } : d))
    } catch (err) {
      setDatos(previa)
      setError(mensajeError(err, 'No se pudo actualizar la etapa'))
    } finally {
      setGuardando(false)
    }
  }

  const avanzar = async () => {
    setError(null)
    setGuardando(true)
    try {
      await avanzarEstadoOrden(orden.id)
      await cargar()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo actualizar el estado'))
    } finally {
      setGuardando(false)
    }
  }

  const fila = (etiqueta: string, valor: string | null) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', padding: 'var(--space-3) 0', borderTop: '1px solid var(--border-hairline)' }}>
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{etiqueta}</span>
      <span style={{ font: 'var(--type-body)', color: 'var(--text-strong)', textAlign: 'right' }}>{valor || '—'}</span>
    </div>
  )

  const avance = (
    <Card
      title="Avance de fabricación"
      subtitle={`Pedido del ${formatearFechaPedido(orden.fechaPedido)}`}
      actions={
        puedeVerComprobante ? (
          <Button size="sm" variant="secondary" iconLeft={<FileDown size={15} />} onClick={descargarComprobante}>
            Descargar comprobante
          </Button>
        ) : undefined
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: esEscritorio ? 'repeat(5, 1fr)' : '1fr 1fr 1fr 1fr 1.9fr',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {ETAPAS.map((e) => (
          <CasillaEtapa
            key={e.id}
            grande
            etiqueta={e.etiqueta}
            descripcion={`${e.etiqueta} del pedido ${orden.numero}`}
            marcada={etapaMarcada(orden, e.id)}
            deshabilitada={bloqueada || guardando}
            onCambiar={(v) => void cambiarEtapa(e.id, v)}
          />
        ))}
      </div>

      {orden.listoEn && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
          Marcado LISTO el {formatearFechaHora(orden.listoEn)}
          {preparadoPorShopify(orden) ? ' porque en Shopify el pedido está Preparado.' : ' desde la app.'}
        </p>
      )}

      {cancelada && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
          Esta orden fue cancelada en Shopify: no se puede modificar.
        </p>
      )}

      {!cancelada && bloqueada && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          La orden ya salió a despacho: sus etapas no se pueden cambiar.
        </p>
      )}

      {!cancelada && orden.estado === 'por_fabricar' && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
          Marca LISTO cuando el mueble esté terminado: pasará a "Fabricado" y podrá despacharse.
        </p>
      )}

      {!cancelada && siguiente && (
        <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-hairline)' }}>
          <Button
            size={esEscritorio ? 'md' : 'touch'}
            fullWidth={!esEscritorio}
            variant="accent"
            iconLeft={<ArrowRight size={17} />}
            disabled={guardando}
            onClick={() => void avanzar()}
          >
            {guardando ? 'Actualizando...' : `Pasar a ${ESTADO_ORDEN_LABEL[siguiente].toLowerCase()}`}
          </Button>
        </div>
      )}

      {!cancelada && orden.estado === 'entregado' && (
        <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Esta orden ya fue entregada.</p>
      )}
    </Card>
  )

  const mueble = (
    <Card title="Mueble">
      <div>
        {fila('Origen', orden.origen ? ORIGEN_LABEL[orden.origen] : null)}
        {fila('Modelo', orden.modelo)}
        {fila('Tipo', orden.tipo)}
        {fila('Orientación', orden.orientacion)}
        {fila('Medida (CM)', orden.cm)}
        {fila('Color', orden.color)}
        {fila('Tela', orden.tela)}
        {fila('Patas', orden.patas)}
        {orden.tituloShopify && fila('Producto en Shopify', orden.tituloShopify)}
      </div>
      {(faltante || patasEnNota || desmarcadoEnShopify) && (
        <div
          role="note"
          style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            border: '1px solid var(--state-warning)',
            borderRadius: 'var(--radius-sm)',
            font: 'var(--type-body)',
            fontSize: 'var(--text-body-sm)',
            color: 'var(--tinta-700)',
          }}
        >
          {faltante && (
            <div>
              <strong>Falta {faltante}.</strong> Este pedido no trae {faltante === 'color y tela' ? 'esos datos' : 'ese dato'} desde Shopify: revisa las notas
              del pedido.
            </div>
          )}
          {patasEnNota && (
            <div>
              <strong>Las notas nombran las patas.</strong> El campo "Patas" dice PREDETERMINADAS: confirma cuáles van antes de fabricar.
            </div>
          )}
          {desmarcadoEnShopify && (
            <div>
              <strong>Shopify ya no lo tiene Preparado.</strong> La app lo había marcado LISTO porque Shopify lo tenía preparado. No se cambió nada: revisa si
              corresponde quitar LISTO.
            </div>
          )}
        </div>
      )}
      {orden.notasProduccion && (
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
          <strong style={{ display: 'block', marginBottom: 4 }}>Notas de producción</strong>
          {orden.notasProduccion}
        </div>
      )}
    </Card>
  )

  const datosCliente = (
    <Card title="Cliente y entrega" subtitle="Datos personales: solo administración y bodega">
      {cliente ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-body)' }}>
            <User size={16} color="var(--text-faint)" style={{ flex: '0 0 auto', marginTop: 3 }} />
            <span>{cliente.cliente || 'Sin nombre'}</span>
          </div>
          {cliente.telefono && (
            <div style={{ display: 'flex', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-body)' }}>
              <Phone size={16} color="var(--text-faint)" style={{ flex: '0 0 auto', marginTop: 3 }} />
              <span>{telefonoLegible(cliente.telefono)}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--text-body)' }}>
            <MapPin size={16} color="var(--text-faint)" style={{ flex: '0 0 auto', marginTop: 3 }} />
            <div>
              {cliente.direccion && <div>{cliente.direccion}</div>}
              <div>{[orden.comuna, orden.region].filter(Boolean).join(', ') || 'Sin dirección'}</div>
              {orden.comunaRevisar && (
                <div style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
                  La comuna no está en la lista oficial: revisar.
                </div>
              )}
            </div>
          </div>
          {cliente.infAdicional && (
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <ClipboardList size={16} color="var(--text-faint)" style={{ flex: '0 0 auto', marginTop: 3 }} />
              <div>
                <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', marginBottom: 2 }}>Información adicional (completa)</div>
                <div style={{ font: 'var(--type-body)', color: 'var(--text-body)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{cliente.infAdicional}</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Esta orden no tiene datos de cliente guardados.</span>
      )}
    </Card>
  )

  const delPedido = hermanas.length > 0 && (
    <Card padding="0" title="Otros muebles de este pedido">
      {hermanas.map((h, i) => (
        <Link
          key={h.id}
          to={`/pedidos/${h.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            padding: 'var(--space-4) var(--space-6)',
            borderTop: i ? '1px solid var(--border-hairline)' : 'none',
            color: 'inherit',
            textDecoration: 'none',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="rh-num" style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>
              {h.numero}
            </div>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
              {[h.modelo, h.tipo, h.color].filter(Boolean).join(' · ')}
            </div>
          </div>
          <EstadoOrdenBadge estado={h.estado} />
        </Link>
      ))}
    </Card>
  )

  return (
    <Shell
      eyebrow={`ORDEN ${orden.numero}`}
      title={orden.modelo ?? 'Orden de fabricación'}
      actions={
        esEscritorio ? (
          <Button variant="secondary" iconLeft={<ArrowLeft size={16} />} onClick={() => navigate('/pedidos')}>
            Volver al listado
          </Button>
        ) : null
      }
    >
      {esEscritorio && <Breadcrumb items={[{ label: 'Pedidos', to: '/pedidos' }, { label: `Orden ${orden.numero}` }]} />}

      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span role="alert" style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            {error}
          </span>
        </Card>
      )}

      {cancelada && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            <TriangleAlert size={18} /> Pedido cancelado en Shopify
          </span>
        </Card>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <EstadoOrdenBadge estado={orden.estado} />
        {orden.esAdicional && (
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Línea adicional (no es un mueble)</span>
        )}
      </div>

      {esEscritorio ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr .8fr', gap: 'var(--space-5)', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {avance}
            {mueble}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {datosCliente}
            {delPedido}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {avance}
          {mueble}
          {datosCliente}
          {delPedido}
        </div>
      )}

      {puedeVerComprobante && <ComprobanteDespacho orden={orden} muebles={mueblesDelDespacho} cliente={cliente} emitidoEn={emitidoEn} />}
    </Shell>
  )
}
