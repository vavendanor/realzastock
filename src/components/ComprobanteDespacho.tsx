import { createPortal } from 'react-dom'
import { formatearFechaHora, formatearTelefono } from '../lib/format'
import type { Pedido, UbicacionStock } from '../types'

const ETIQUETA_UBICACION: Record<UbicacionStock, string> = {
  bodega: 'Bodega',
  showroom: 'Showroom',
}

interface Props {
  pedido: Pedido
  /* ISO del momento en que se pidió el comprobante; lo fija quien lo imprime
     para que la hora impresa sea la de emisión y no la de carga de la pantalla. */
  emitidoEn: string
}

/* Comprobante de despacho para bodega: sin precios, con espacio para firma.
   Se monta con un portal directamente en <body>, oculto en pantalla; los
   estilos de impresión (styles/impresion.css) ocultan la app y muestran
   solo esto. Es un documento interno de control, no una guía de despacho. */
export function ComprobanteDespacho({ pedido, emitidoEn }: Props) {
  const numero = pedido.id.slice(0, 8).toUpperCase()
  const { direccion } = pedido

  /* Fecha de despacho: la guardada (migración 0010) cuando existe. Los
     pedidos despachados antes de esa migración no la tienen; ahí, mientras
     sigan en "Despachado", la última actualización sí es la de despacho. Si
     ya están "Entregados", ese dato pasó a ser la fecha de entrega y la de
     despacho no se puede saber: se deja una línea para anotarla a mano. */
  const fechaDespacho =
    pedido.despachadoEn ?? (pedido.estado === 'despachado' ? pedido.fechaActualizacion : null)

  return createPortal(
    <div className="comprobante-impresion" aria-hidden="true">
      <div className="cp-encabezado">
        <div className="cp-marca">
          <img className="cp-logo" src="/pwa-512x512.png" alt="" />
          <span className="cp-marca-nombre">Realza Hogar</span>
        </div>
        <div className="cp-titulo-bloque">
          <div className="cp-titulo">Comprobante de despacho</div>
          <div className="cp-numero">Pedido N.º {numero}</div>
        </div>
      </div>

      <div className="cp-grid">
        <div>
          <div className="cp-etiqueta">Fecha del pedido</div>
          <div className="cp-valor">{formatearFechaHora(pedido.fechaCreacion)}</div>
        </div>

        <div>
          <div className="cp-etiqueta">Fecha de despacho</div>
          {fechaDespacho ? (
            <div className="cp-valor">{formatearFechaHora(fechaDespacho)}</div>
          ) : (
            <div className="cp-valor">
              <span className="cp-linea-manual" />
              <div className="cp-nota">Entregado el {formatearFechaHora(pedido.fechaActualizacion)} (según el sistema)</div>
            </div>
          )}
        </div>

        <div>
          <div className="cp-etiqueta">Cliente</div>
          <div className="cp-valor cp-valor-fuerte">{pedido.clienteNombre}</div>
        </div>

        <div>
          <div className="cp-etiqueta">Teléfono</div>
          <div className="cp-valor">
            {pedido.clienteContacto ? formatearTelefono(pedido.clienteContacto) : 'No informado'}
          </div>
        </div>

        <div className="cp-ancho">
          <div className="cp-etiqueta">Dirección de despacho</div>
          <div className="cp-valor">
            <div className="cp-valor-fuerte">{direccion.calle}</div>
            <div>
              {direccion.comuna}
              {direccion.ciudad ? `, ${direccion.ciudad}` : ''}
              {' · '}
              {direccion.region}
            </div>
            {direccion.referencia && <div className="cp-nota">Referencia: {direccion.referencia}</div>}
          </div>
        </div>

        {/* Ubicación de despacho, en este orden de prioridad:
            1) pedido basado en una venta: no se movió stock al despachar (ya se
               descontó al vender), así que no hay ubicación que informar;
            2) ubicación guardada al despachar (migración 0010);
            3) pedidos despachados antes de esa migración: no hay dato, así que
               se marca a mano. */}
        <div className="cp-ancho">
          <div className="cp-etiqueta">Despachado desde</div>
          {pedido.ventaId ? (
            <div className="cp-valor">No aplica (ya descontado al vender)</div>
          ) : pedido.despachadoDesde ? (
            <div className="cp-valor cp-valor-fuerte">{ETIQUETA_UBICACION[pedido.despachadoDesde]}</div>
          ) : (
            <div className="cp-opciones">
              <span className="cp-opcion">
                <span className="cp-casilla" /> Bodega
              </span>
              <span className="cp-opcion">
                <span className="cp-casilla" /> Showroom
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="cp-seccion">Productos</div>
      <table className="cp-tabla">
        <thead>
          <tr>
            <th>Producto</th>
            <th>SKU</th>
            <th className="cp-derecha">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          {pedido.items.map((item, i) => (
            <tr key={i}>
              <td>
                {item.modelo} · {item.material} · {item.color}
              </td>
              <td className="cp-sku">{item.sku}</td>
              <td className="cp-derecha">{item.cantidad}</td>
            </tr>
          ))}
          <tr className="cp-total">
            <td colSpan={2}>Total de unidades</td>
            <td className="cp-derecha">{pedido.unidades}</td>
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
