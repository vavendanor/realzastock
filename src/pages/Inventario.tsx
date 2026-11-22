import { Check, RotateCw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { IconButton } from '../components/ui/IconButton'
import { Input } from '../components/ui/Input'
import { ajustarTela, estaBajoMinimo, formatearMetros, leerMetros, listarTelas, type Tela } from '../lib/telas'

/* Inventario de telas (solo administrador): las 4 telas con su cantidad en metros y su stock mínimo. Los dos números
   se pueden ajustar acá; el Dashboard avisa cuando una tela está en o bajo su mínimo. */
function TarjetaTela({ tela, alGuardar }: { tela: Tela; alGuardar: (t: Tela, metros: number, minimo: number) => Promise<void> }) {
  const [metros, setMetros] = useState(String(tela.metros).replace('.', ','))
  const [minimo, setMinimo] = useState(String(tela.stockMinimo).replace('.', ','))
  const [guardando, setGuardando] = useState(false)

  const nuevosMetros = leerMetros(metros)
  const nuevoMinimo = leerMetros(minimo)
  const valido = nuevosMetros !== null && nuevoMinimo !== null
  const cambio = valido && (nuevosMetros !== tela.metros || nuevoMinimo !== tela.stockMinimo)
  const bajo = estaBajoMinimo(tela)

  const guardar = async () => {
    if (!valido) return
    setGuardando(true)
    try {
      await alGuardar(tela, nuevosMetros, nuevoMinimo)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card padding="var(--space-5)">
      <div data-tela={tela.nombre} data-bajo={bajo ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <div>
            <div style={{ font: 'var(--type-h3)', color: 'var(--text-strong)' }}>{tela.nombre}</div>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
              Hay {formatearMetros(tela.metros)} · mínimo {formatearMetros(tela.stockMinimo)}
            </div>
          </div>
          {bajo && (
            <span
              data-alerta-stock
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--state-danger-soft)', color: 'var(--state-danger)', font: 'var(--fw-bold) var(--text-body-sm)/1.3 var(--font-sans)', whiteSpace: 'nowrap' }}
            >
              <TriangleAlert size={14} /> Stock bajo
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Input
            label="Cantidad (metros)"
            inputMode="decimal"
            value={metros}
            onChange={(e) => setMetros(e.target.value)}
            error={metros !== '' && nuevosMetros === null ? 'Número de 0 o más' : undefined}
          />
          <Input
            label="Mínimo (metros)"
            inputMode="decimal"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            error={minimo !== '' && nuevoMinimo === null ? 'Número de 0 o más' : undefined}
          />
        </div>
        <Button variant="accent" disabled={!cambio || guardando} iconLeft={<Check size={16} />} onClick={() => void guardar()}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </Button>
      </div>
    </Card>
  )
}

export function Inventario() {
  const [telas, setTelas] = useState<Tela[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setTelas(await listarTelas())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar las telas')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async (tela: Tela, metros: number, minimo: number) => {
    setError(null)
    try {
      await ajustarTela(tela.id, metros, minimo)
      setTelas((previas) => previas.map((t) => (t.id === tela.id ? { ...t, metros, stockMinimo: minimo } : t)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la tela')
    }
  }

  return (
    <Shell
      eyebrow="BODEGA DE TELAS"
      title="Inventario"
      actions={
        <IconButton label="Recargar" variant="outline" onClick={() => void cargar()}>
          <RotateCw size={15} />
        </IconButton>
      }
    >
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      {cargando && telas.length === 0 && (
        <Card>
          <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando telas...</span>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-4)' }}>
        {telas.map((tela) => (
          <TarjetaTela key={`${tela.id}-${tela.metros}-${tela.stockMinimo}`} tela={tela} alGuardar={guardar} />
        ))}
      </div>
    </Shell>
  )
}
