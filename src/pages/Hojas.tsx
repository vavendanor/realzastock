import { ClipboardList, Plus, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { listarTarjetasHojas, type TarjetaHoja } from '../lib/hojas'

const fechaDeCreacion = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric' })

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

function TarjetaDeHoja({ hoja }: { hoja: TarjetaHoja }) {
  const porcentaje = Math.round(hoja.avance * 100)
  return (
    <Card padding="var(--space-5)" aria-label={`Hoja ${hoja.nombre}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <h3 style={{ font: 'var(--type-h3)', fontSize: '18px', color: 'var(--text-strong)', overflowWrap: 'anywhere' }}>{hoja.nombre}</h3>
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Creada el {fechaDeCreacion(hoja.creadaEn)}</span>
        </div>

        <div style={{ font: 'var(--type-body)', color: 'var(--text-body)' }}>
          {plural(hoja.pedidos, 'pedido', 'pedidos')} ·{' '}
          <strong>
            {hoja.pendientes} de {plural(hoja.piezas, 'pieza', 'piezas')}
          </strong>{' '}
          por fabricar
        </div>

        <div
          role="progressbar"
          aria-label={`Avance de ${hoja.nombre}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcentaje}
          style={{ height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--arena-300)', overflow: 'hidden' }}
        >
          <div style={{ width: `${porcentaje}%`, height: '100%', background: 'var(--state-success)' }} />
        </div>
        <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{porcentaje}% fabricado</span>

        <div
          style={{
            font: 'var(--fw-bold) var(--text-body-sm)/1.3 var(--font-sans)',
            color: hoja.retrasoMaximo > 0 ? 'var(--state-danger)' : 'var(--text-muted)',
          }}
        >
          {hoja.retrasoMaximo > 0 ? `Retraso máximo: ${plural(hoja.retrasoMaximo, 'día hábil', 'días hábiles')}` : 'Sin retraso'}
        </div>
        {hoja.sinCalendario && (
          <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            Faltan feriados de algún año: el retraso puede no ser exacto.
          </span>
        )}
      </div>
    </Card>
  )
}

/* Listado de las hojas de fabricación, solo lectura (el detalle de cada una llega después). La
   base de datos limita el acceso a administrador y bodega. */
export function Hojas() {
  const esEscritorio = useEsEscritorio()
  const navigate = useNavigate()
  const [tarjetas, setTarjetas] = useState<TarjetaHoja[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setTarjetas((await listarTarjetasHojas()).tarjetas)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las hojas.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <Shell
      eyebrow="OPERACIÓN"
      title="Hojas de fabricación"
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="secondary" aria-label="Recargar" iconLeft={<RotateCw size={15} />} onClick={() => void cargar()}>
            {esEscritorio ? 'Recargar' : ''}
          </Button>
          <Button iconLeft={<Plus size={15} />} onClick={() => navigate('/hojas/nueva')}>
            {esEscritorio ? 'Crear hoja de fabricación' : 'Crear'}
          </Button>
        </div>
      }
    >
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span role="alert" style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>
            {error}
          </span>
        </Card>
      )}

      {cargando && tarjetas === null && (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando hojas...</span>
        </Card>
      )}

      {tarjetas !== null && tarjetas.length === 0 && (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'var(--space-3)', padding: 'var(--space-6) var(--space-4)' }}>
            <ClipboardList size={30} color="var(--nogal-600)" />
            <h3 style={{ font: 'var(--type-h3)', color: 'var(--text-strong)' }}>Aún no hay hojas de fabricación</h3>
            <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)', maxWidth: 460 }}>
              Una hoja agrupa los pedidos que el taller fabrica junto. Crea la primera eligiendo los pedidos por fabricar.
            </p>
          </div>
        </Card>
      )}

      {tarjetas !== null && tarjetas.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
          {tarjetas.map((t) => (
            <TarjetaDeHoja key={t.id} hoja={t} />
          ))}
        </div>
      )}
    </Shell>
  )
}
