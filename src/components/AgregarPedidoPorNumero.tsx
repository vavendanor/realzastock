import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { descripcionDeResumen, hojasDelPedido, normalizarNumeroPedido, obtenerResumenPedido, type ResumenPedido } from '../lib/hojas'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

interface Hallado {
  resumen: ResumenPedido
  /* Nombres de las hojas donde ya está el pedido. */
  enHojas: string[]
}

interface Props {
  /* Pedidos que la hoja ya tiene (para no agregarlos dos veces). */
  incluidos: ReadonlySet<string>
  /* Qué hacer al confirmar. Si falla, el mensaje del error se muestra aquí y el pedido sigue sin agregarse. */
  alAgregar: (pedido: ResumenPedido) => void | Promise<void>
}

/* "Agregar pedido por N°": busca el pedido, muestra cuál es (fecha, piezas, modelos y en qué otras hojas
   está) y solo lo agrega cuando se confirma. Un pedido puede estar en varias hojas. */
export function AgregarPedidoPorNumero({ incluidos, alAgregar }: Props) {
  const [texto, setTexto] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [agregando, setAgregando] = useState(false)
  const [hallado, setHallado] = useState<Hallado | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buscar = async (e: FormEvent) => {
    e.preventDefault()
    setHallado(null)
    setError(null)
    const numero = normalizarNumeroPedido(texto)
    if (!numero) {
      setError('Escribe un número de pedido válido (solo letras y números).')
      return
    }
    if (incluidos.has(numero)) {
      setError(`El pedido ${numero} ya está en la hoja.`)
      return
    }
    setBuscando(true)
    try {
      const [resumen, enHojas] = await Promise.all([obtenerResumenPedido(numero), hojasDelPedido(numero)])
      if (!resumen) setError(`No se encontró el pedido ${numero} (o todas sus piezas están canceladas).`)
      else setHallado({ resumen, enHojas })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo buscar el pedido.')
    } finally {
      setBuscando(false)
    }
  }

  const agregar = async () => {
    if (!hallado) return
    setAgregando(true)
    setError(null)
    try {
      await alAgregar(hallado.resumen)
      setHallado(null)
      setTexto('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el pedido.')
    } finally {
      setAgregando(false)
    }
  }

  return (
    <form onSubmit={(e) => void buscar(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Input
          label="Agregar pedido por N°"
          placeholder="Ej. 1280"
          inputMode="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          wrapperStyle={{ flex: '1 1 180px' }}
        />
        <Button type="submit" variant="secondary" iconLeft={<Search size={15} />} disabled={buscando || texto.trim() === ''}>
          {buscando ? 'Buscando...' : 'Buscar'}
        </Button>
      </div>
      {error && (
        <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
          {error}
        </span>
      )}
      {hallado && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--arena-100)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-hairline)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>Pedido {hallado.resumen.pedidoNumero}</div>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{descripcionDeResumen(hallado.resumen)}</div>
            {hallado.resumen.porFabricar === 0 && (
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-body)' }}>Este pedido no tiene piezas por fabricar.</div>
            )}
            {hallado.enHojas.length > 0 && (
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-body)' }}>Ya está en: {hallado.enHojas.join(', ')}.</div>
            )}
          </div>
          <Button size="sm" disabled={agregando} onClick={() => void agregar()}>
            {agregando ? 'Agregando...' : 'Agregar a la hoja'}
          </Button>
        </div>
      )}
    </form>
  )
}
