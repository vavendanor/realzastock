import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { haceCuanto, leerEstadoSincronizacion, sincronizacionEnCurso, sincronizarAhora, type EstadoSincronizacion } from '../lib/sincronizacion'

interface Props {
  /* Se llama al terminar una sincronización manual, para recargar la lista. */
  alTerminar: () => void
}

const REFRESCO_MS = 60_000

/* Indicador de la última sincronización con Shopify y botón para lanzarla a
   mano. Solo se monta para el administrador (la política de lectura de
   sync_shopify y la Edge Function también lo exigen). */
export function SincronizacionShopify({ alTerminar }: Props) {
  const [estado, setEstado] = useState<EstadoSincronizacion | null>(null)
  const [errorLectura, setErrorLectura] = useState<string | null>(null)
  const [ahora, setAhora] = useState(() => new Date())
  const [corriendo, setCorriendo] = useState(false)
  const [resultado, setResultado] = useState<{ texto: string; malo: boolean } | null>(null)

  const cargar = useCallback(async () => {
    try {
      setEstado(await leerEstadoSincronizacion())
      setErrorLectura(null)
    } catch (e) {
      setErrorLectura(e instanceof Error ? e.message : 'No se pudo leer el estado.')
    }
    setAhora(new Date())
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar()
    const t = setInterval(() => void cargar(), REFRESCO_MS)
    return () => clearInterval(t)
  }, [cargar])

  const enCurso = corriendo || sincronizacionEnCurso(estado, ahora)

  async function lanzar() {
    setCorriendo(true)
    setResultado(null)
    try {
      const r = await sincronizarAhora()
      setResultado({ texto: r.mensaje, malo: r.conErrores })
    } catch (e) {
      setResultado({ texto: e instanceof Error ? e.message : 'No se pudo sincronizar.', malo: true })
    } finally {
      setCorriendo(false)
      await cargar()
      alTerminar()
    }
  }

  /* El error guardado solo importa si es de la última corrida: si después hubo
     una sincronización buena, la base lo borra (ultimo_error queda en null). */
  const fallo = estado?.ultimoError ?? null

  return (
    <Card padding="var(--space-3) var(--space-4)" style={{ marginBottom: 'var(--space-4)' }} data-testid="sincronizacion-shopify">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: 'var(--type-body)', color: 'var(--text-strong)' }}>
            {enCurso ? 'Sincronizando con Shopify…' : <>Última sincronización: <strong>{haceCuanto(estado?.ultimaSincronizacion ?? null, ahora)}</strong></>}
          </div>
          {errorLectura && (
            <div style={{ font: 'var(--type-caption)', color: 'var(--state-danger)', marginTop: 2 }}>No se pudo leer el estado: {errorLectura}</div>
          )}
        </div>
        <Button variant="secondary" size="sm" iconLeft={<RefreshCw size={15} className={enCurso ? 'girar' : undefined} />} disabled={enCurso} onClick={() => void lanzar()}>
          Sincronizar ahora
        </Button>
      </div>

      {fallo && !enCurso && (
        <div
          role="alert"
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--state-danger-soft)',
            color: 'var(--state-danger)',
            font: 'var(--type-caption)',
            wordBreak: 'break-word',
          }}
        >
          <strong>La última sincronización falló</strong>
          {estado?.ultimoIntento ? ` (${haceCuanto(estado.ultimoIntento, ahora)})` : ''}: {fallo}
        </div>
      )}

      {resultado && (
        <div
          role="status"
          style={{ marginTop: 'var(--space-3)', font: 'var(--type-caption)', color: resultado.malo ? 'var(--state-danger)' : 'var(--state-success)' }}
        >
          {resultado.texto}
        </div>
      )}
    </Card>
  )
}
