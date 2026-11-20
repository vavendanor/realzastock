import { FileDown } from 'lucide-react'
import { useState } from 'react'
import { exportarPedidosAExcel } from '../lib/exportarPedidos'
import { FILTROS_ORDENES_VACIOS } from '../lib/ordenes'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Input } from './ui/Input'

/* La planilla de pedidos en Excel (19 columnas, un mueble por fila), con fechas Desde/Hasta opcionales.
   Vive en el Dashboard, que solo ve el administrador (la base de datos protege además los datos de clientes). */
export function ExportarPedidos() {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [exportando, setExportando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const fechasInvertidas = Boolean(desde && hasta && desde > hasta)

  const exportar = async () => {
    setExportando(true)
    setAviso(null)
    try {
      const r = await exportarPedidosAExcel({ ...FILTROS_ORDENES_VACIOS, desde, hasta })
      setAviso({ tipo: 'ok', texto: `Se descargó ${r.archivo} con ${r.filas} ${r.filas === 1 ? 'fila' : 'filas'}.` })
    } catch (err) {
      setAviso({ tipo: 'error', texto: err instanceof Error ? err.message : 'No se pudo generar el archivo.' })
    } finally {
      setExportando(false)
    }
  }

  return (
    <Card title="Planilla de pedidos" subtitle="Todos los pedidos, un mueble por fila. Sin fechas, se exportan todos.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 520 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-3)' }}>
          <Input label="Desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
          <Input label="Hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
        </div>
        {fechasInvertidas && <span style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>La fecha "Desde" es posterior a "Hasta".</span>}
        <div>
          <Button iconLeft={<FileDown size={16} />} disabled={exportando || fechasInvertidas} onClick={() => void exportar()}>
            {exportando ? 'Generando Excel...' : 'Exportar a Excel (19 columnas)'}
          </Button>
        </div>
        {aviso && (
          <span role={aviso.tipo === 'error' ? 'alert' : 'status'} style={{ font: 'var(--type-body)', color: aviso.tipo === 'ok' ? 'var(--text-strong)' : 'var(--state-danger)' }}>
            {aviso.texto}
          </span>
        )}
      </div>
    </Card>
  )
}
