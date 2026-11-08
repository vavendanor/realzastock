import { plural } from '../lib/cambiosPendientes'
import { Button } from './ui/Button'
import { Dialogo } from './ui/Dialogo'

interface Props {
  total: number
  motivo: 'salir' | 'cerrar-sesion'
  alQuedarme: () => void
  alSalir: () => void
}

/* Se muestra al intentar salir del módulo de producción, o cerrar sesión, con
   cambios de casillas sin guardar. Seguir significa descartarlos. */
export function AvisoSalida({ total, motivo, alQuedarme, alSalir }: Props) {
  const cerrandoSesion = motivo === 'cerrar-sesion'
  return (
    <Dialogo
      titulo="Tienes cambios sin guardar"
      alCancelar={alQuedarme}
      acciones={
        <>
          <Button variant="primary" data-inicial onClick={alQuedarme}>
            {cerrandoSesion ? 'Seguir en la app' : 'Quedarme'}
          </Button>
          <Button variant="danger" onClick={alSalir}>
            {cerrandoSesion ? 'Cerrar sesión y descartar' : 'Salir y descartar'}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {cerrandoSesion ? 'Si cierras la sesión' : 'Si sales de esta sección'}, se descartarán los <strong>{plural(total, 'cambio', 'cambios')}</strong> que no has guardado.
      </p>
    </Dialogo>
  )
}
