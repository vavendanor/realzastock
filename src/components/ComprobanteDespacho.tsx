import { createPortal } from 'react-dom'
import { formatearFechaHora, formatearTelefono, normalizarTelefono, telefonoValido } from '../lib/format'
import { formatearFechaPedido } from '../lib/ordenes'
import type { DatosClienteOrden, OrdenFabricacion } from '../types'

interface Props {
  /* Una de las órdenes del pedido: de ella salen los datos que son del
     pedido completo (número, fecha, comuna, notas de entrega). */
  orden: OrdenFabricacion
  /* Los muebles de ese pedido que salen en este despacho: los que están en
     despacho o entregados. */
  muebles: OrdenFabricacion[]
  cliente: DatosClienteOrden | null
  /* ISO del momento en que se pidió el comprobante; lo fija quien lo imprime
     para que la hora impresa sea la de emisión y no la de carga de la pantalla. */
  emitidoEn: string
}

/* El teléfono de Shopify viene como "+56912345678"; si es un móvil chileno se
   deja como "+56 9 1234 5678" y, si no, tal cual vino. */
function telefonoLegible(valor: string) {
  const digitos = normalizarTelefono(valor)
  return telefonoValido(digitos) ? formatearTelefono(digitos) : valor
}

/* Comprobante de despacho para bodega, uno por PEDIDO de Shopify: lista los
   muebles del pedido que salen a despacho. Sin precios y SIN RUT (la nota
   completa del pedido, con RUT y correo, no se imprime), con espacio para
   firma. Se monta con un portal directamente en <body>, oculto en pantalla;
   los estilos de impresión (styles/impresion.css) ocultan la app y muestran
   solo esto. Es un documento interno de control, no una guía de despacho. */
export function ComprobanteDespacho({ orden, muebles, cliente, emitidoEn }: Props) {
  /* Fecha de despacho: la primera guardada entre los muebles (migración 0013).
     Las órdenes que ya estaban en despacho antes de esa migración no la
     tienen: se deja una línea para anotarla a mano y se informa la última
     actualización del sistema como referencia. */
  const fechasDespacho = muebles.map((m) => m.despachadoEn).filter((f): f is string => f !== null)
  const fechaDespacho = fechasDespacho.length ? fechasDespacho.reduce((a, b) => (a < b ? a : b)) : null
  const ultimaActualizacion = muebles.reduce((a, m) => (m.actualizadoEn > a ? m.actualizadoEn : a), '')

  const direccion = [cliente?.direccion, [orden.comuna, orden.region].filter(Boolean).join(' · ')].filter(Boolean)

  return createPortal(
    <div className="comprobante-impresion" aria-hidden="true">
      <div className="cp-encabezado">
        <div className="cp-marca">
          <img className="cp-logo" src="/pwa-512x512.png" alt="" />
          <span className="cp-marca-nombre">Realza Hogar</span>
        </div>
        <div className="cp-titulo-bloque">
          <div className="cp-titulo">Comprobante de despacho</div>
          <div className="cp-numero">Pedido N.º {orden.pedidoNumero}</div>
        </div>
      </div>

      <div className="cp-grid">
        <div>
          <div className="cp-etiqueta">Fecha del pedido</div>
          <div className="cp-valor">{formatearFechaPedido(orden.fechaPedido)}</div>
        </div>

        <div>
          <div className="cp-etiqueta">Fecha de despacho</div>
          {fechaDespacho ? (
            <div className="cp-valor">{formatearFechaHora(fechaDespacho)}</div>
          ) : (
            <div className="cp-valor">
              <span className="cp-linea-manual" />
              <div className="cp-nota">Última actualización del sistema: {formatearFechaHora(ultimaActualizacion)}</div>
            </div>
          )}
        </div>

        <div>
          <div className="cp-etiqueta">Cliente</div>
          <div className="cp-valor cp-valor-fuerte">{cliente?.cliente || 'No informado'}</div>
        </div>

        <div>
          <div className="cp-etiqueta">Teléfono</div>
          <div className="cp-valor">{cliente?.telefono ? telefonoLegible(cliente.telefono) : 'No informado'}</div>
        </div>

        <div className="cp-ancho">
          <div className="cp-etiqueta">Dirección de despacho</div>
          <div className="cp-valor">
            {direccion.length === 0 && <div className="cp-valor-fuerte">No informada</div>}
            {direccion.map((linea, i) => (
              <div key={i} className={i === 0 ? 'cp-valor-fuerte' : undefined}>
                {linea}
              </div>
            ))}
          </div>
        </div>

        {orden.notasProduccion && (
          <div className="cp-ancho">
            <div className="cp-etiqueta">Notas del pedido</div>
            <div className="cp-valor">{orden.notasProduccion}</div>
          </div>
        )}
      </div>

      <div className="cp-seccion">Muebles</div>
      <table className="cp-tabla">
        <thead>
          <tr>
            <th>N.º</th>
            <th>Mueble</th>
            <th>Medida</th>
            <th>Color y tela</th>
            <th>Patas</th>
          </tr>
        </thead>
        <tbody>
          {muebles.map((m) => (
            <tr key={m.id}>
              <td className="cp-num">{m.numero}</td>
              <td>
                {m.modelo ?? '—'}
                {(m.tipo || (m.orientacion && m.orientacion !== 'ninguna')) && (
                  <div className="cp-nota">
                    {[m.tipo, m.orientacion && m.orientacion !== 'ninguna' ? `orientación ${m.orientacion}` : null].filter(Boolean).join(' · ')}
                  </div>
                )}
              </td>
              <td>{m.cm ?? '—'}</td>
              <td>{[m.color, m.tela].filter(Boolean).join(' · ') || '—'}</td>
              <td>{m.patas}</td>
            </tr>
          ))}
          <tr className="cp-total">
            <td colSpan={4}>Total de muebles</td>
            <td>{muebles.length}</td>
          </tr>
        </tbody>
      </table>

      <div className="cp-firmas">
        <div>
          <div className="cp-firma-espacio" />
          <div className="cp-firma">Nombre de quien recibe</div>
        </div>
        <div>
          <div className="cp-firma-espacio" />
          <div className="cp-firma">Firma</div>
        </div>
      </div>

      <div className="cp-pie">
        Emitido el {formatearFechaHora(emitidoEn)} · Documento interno de control de bodega: no es una guía de despacho
        ni un documento tributario.
      </div>
    </div>,
    document.body,
  )
}
