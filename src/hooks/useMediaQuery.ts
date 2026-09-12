import { useEffect, useState } from 'react'

/* Ancho a partir del cual se muestra el panel de escritorio con sidebar.
   Por debajo, el Shell cambia a la navegación inferior tipo app. */
export const BREAKPOINT_ESCRITORIO = '(min-width: 900px)'

export function useMediaQuery(query: string) {
  const [coincide, setCoincide] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const alCambiar = (evento: MediaQueryListEvent) => setCoincide(evento.matches)

    setCoincide(mql.matches)
    mql.addEventListener('change', alCambiar)
    return () => mql.removeEventListener('change', alCambiar)
  }, [query])

  return coincide
}

export function useEsEscritorio() {
  return useMediaQuery(BREAKPOINT_ESCRITORIO)
}
