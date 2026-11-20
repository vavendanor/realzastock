import { useState } from 'react'
import { flushSync } from 'react-dom'
import { imprimirConTitulo } from '../lib/comprobante'

/* Para imprimir el comprobante de despacho de un pedido (ComprobanteDespacho). `emitidoEn` es la hora que
   debe llevar impresa; `imprimir` la fija y abre el diálogo de impresión. */
export function useComprobante() {
  const [emitidoEn, setEmitidoEn] = useState(() => new Date().toISOString())

  const imprimir = (pedido: string) => {
    /* flushSync: la hora de emisión tiene que estar pintada ANTES de abrir el diálogo de impresión, y un
       setState normal se aplicaría después. */
    flushSync(() => setEmitidoEn(new Date().toISOString()))
    imprimirConTitulo(`Comprobante de despacho ${pedido}`)
  }

  return { emitidoEn, imprimir }
}
