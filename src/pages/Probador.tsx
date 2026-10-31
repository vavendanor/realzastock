import { ProbadorHerramienta } from '../components/ProbadorHerramienta'
import { Shell } from '../components/layout/Shell'

/* Herramienta para administración y bodega (ver el rol en App.tsx). */
export function Probador() {
  return (
    <Shell eyebrow="HERRAMIENTAS" title="Probador de colores">
      <ProbadorHerramienta />
    </Shell>
  )
}
