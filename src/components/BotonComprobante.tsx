import { FileDown } from 'lucide-react'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { useComprobante } from '../hooks/useComprobante'
import { mueblesDeDespacho, salenADespacho } from '../lib/despachos'
import { obtenerOrden, type OrdenCompleta } from '../lib/ordenes'
import { ComprobanteDespacho } from './ComprobanteDespacho'
import { Button } from './ui/Button'

/* "Comprobante del pedido X": trae los datos del pedido (incluidos los del cliente, que solo ven administrador y
   bodega) y abre el diálogo de impresión con el mismo comprobante de despacho del detalle de un pedido. `ordenId`
   es cualquier mueble del pedido que ya salió a despacho. */
export function BotonComprobante({ ordenId, pedido }: { ordenId: string; pedido: string }) {
  const { emitidoEn, imprimir } = useComprobante()
  const [datos, setDatos] = useState<OrdenCompleta | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pulsar = async () => {
    setCargando(true)
    setError(null)
    try {
      const d = await obtenerOrden(ordenId)
      if (!salenADespacho(d.orden)) throw new Error('Este mueble todavía no salió a despacho.')
      /* El comprobante tiene que estar pintado antes de abrir la impresión. */
      flushSync(() => setDatos(d))
      imprimir(pedido)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo preparar el comprobante.')
    } finally {
      setCargando(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" aria-label={`Comprobante del pedido ${pedido}`} iconLeft={<FileDown size={14} />} disabled={cargando} onClick={() => void pulsar()}>
        {cargando ? 'Preparando...' : `Comprobante ${pedido}`}
      </Button>
      {error && (
        <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
          {error}
        </span>
      )}
      {datos && <ComprobanteDespacho orden={datos.orden} muebles={mueblesDeDespacho(datos.orden, datos.hermanas)} cliente={datos.cliente} emitidoEn={emitidoEn} />}
    </>
  )
}
