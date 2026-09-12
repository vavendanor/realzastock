import { useCallback, useEffect, useState } from 'react'

/* 'beforeinstallprompt' y su evento todavía no son parte del DOM estándar
   (siguen en el "WICG" — el borrador previo a estándar), así que TypeScript
   no los conoce de fábrica. Se los enseña acá para todo el proyecto. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
    /* Disparado por el script inline de index.html justo después de
       guardar el evento nativo, para avisar a React si ya se montó. */
    'rh-install-disponible': CustomEvent
  }
  interface Window {
    /* Guardado por el script inline de index.html, que escucha el evento
       antes de que React siquiera se descargue. Ver ese archivo para el
       porqué completo. */
    __rhInstallEvent: BeforeInstallPromptEvent | null
  }
}

function detectarIOS() {
  if (typeof navigator === 'undefined') return false
  // Safari, Chrome y Firefox en iOS/iPadOS corren todos sobre WebKit por
  // regla de Apple, así que ninguno dispara 'beforeinstallprompt' — la
  // detección es "es iOS", no "es Safari".
  const esIphoneOIpod = /iphone|ipod/i.test(navigator.userAgent)
  // Desde iPadOS 13, el iPad se identifica como "Macintosh" con soporte
  // táctil; sin este chequeo, un iPad quedaría clasificado como escritorio.
  const esIpad = /ipad/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return esIphoneOIpod || esIpad
}

function detectarInstalada() {
  if (typeof window === 'undefined') return false
  const comoStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // iOS no tiene 'display-mode: standalone' vía matchMedia en versiones
  // viejas; expone en cambio esta propiedad no estándar en el navigator.
  const comoStandaloneIOS = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return comoStandalone || comoStandaloneIOS
}

/* Centraliza todo lo necesario para el botón de "Instalar app":
   - Chrome/Edge/Android: captura 'beforeinstallprompt' y expone `instalar()`
     para disparar el prompt nativo cuando el usuario hace clic.
   - iOS (Safari/Chrome/Firefox, todos WebKit): ese evento no existe. No hay
     forma programática de instalar -- la única vía es que la persona misma
     use Compartir -> "Agregar a pantalla de inicio". `esIOS` se expone para
     que el botón muestre esas instrucciones en vez de intentar un prompt.
   - Cualquier navegador sin soporte de instalación (ej. Firefox de
     escritorio): ni dispara el evento ni es iOS, así que `mostrarBoton`
     queda en `false` y no aparece nada -- no hay nada que ofrecer.

   Sobre el timing (esto es lo que causaba que el botón no apareciera):
   'beforeinstallprompt' se dispara una sola vez, muy temprano, y no se
   puede volver a pedir si nadie lo escuchó a tiempo. Este hook se monta
   recién cuando React arma el árbol completo (Shell -> TopBar -> este
   componente), lo cual pasa DESPUÉS de que `ProtectedRoute` termine de
   verificar la sesión con Supabase -- un viaje de ida y vuelta a
   internet que fácilmente tarda más que lo que Chrome espera antes de
   disparar el evento. El script inline de index.html lo captura apenas
   carga la página (antes que cualquier JS de React) y lo deja guardado en
   `window.__rhInstallEvent`; acá simplemente se lee ese valor al montar,
   sin importar cuánto haya tardado React en llegar. */
export function useInstallPrompt() {
  const [eventoDiferido, setEventoDiferido] = useState<BeforeInstallPromptEvent | null>(
    () => (typeof window !== 'undefined' ? window.__rhInstallEvent : null),
  )
  const [yaInstalada, setYaInstalada] = useState(detectarInstalada)
  const [esIOS] = useState(detectarIOS)

  useEffect(() => {
    // Por si el script inline ya lo capturó antes de este primer render
    // (el caso común) pero después del useState de arriba (raro, pero
    // gratis cubrirlo también acá).
    if (window.__rhInstallEvent && !eventoDiferido) {
      setEventoDiferido(window.__rhInstallEvent)
    }

    const alCapturarPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault()
      window.__rhInstallEvent = event
      setEventoDiferido(event)
    }

    // Disparado por el script inline justo después de guardar el evento:
    // cubre el caso en que React ya está montado cuando el navegador por
    // fin dispara 'beforeinstallprompt'.
    const alAvisarDisponible = () => {
      if (window.__rhInstallEvent) setEventoDiferido(window.__rhInstallEvent)
    }

    const alQuedarInstalada = () => {
      setYaInstalada(true)
      window.__rhInstallEvent = null
      setEventoDiferido(null)
    }

    window.addEventListener('beforeinstallprompt', alCapturarPrompt)
    window.addEventListener('rh-install-disponible', alAvisarDisponible)
    window.addEventListener('appinstalled', alQuedarInstalada)

    const mql = window.matchMedia('(display-mode: standalone)')
    const alCambiarDisplayMode = (e: MediaQueryListEvent) => setYaInstalada(e.matches)
    mql.addEventListener('change', alCambiarDisplayMode)

    return () => {
      window.removeEventListener('beforeinstallprompt', alCapturarPrompt)
      window.removeEventListener('rh-install-disponible', alAvisarDisponible)
      window.removeEventListener('appinstalled', alQuedarInstalada)
      mql.removeEventListener('change', alCambiarDisplayMode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo se arma una vez; `eventoDiferido` se lee, no se necesita re-suscribir cuando cambia.
  }, [])

  const instalar = useCallback(async () => {
    if (!eventoDiferido) return null
    await eventoDiferido.prompt()
    const eleccion = await eventoDiferido.userChoice
    // El prompt nativo solo se puede usar una vez; si lo rechaza, hay que
    // esperar a que el navegador dispare el evento de nuevo más adelante.
    window.__rhInstallEvent = null
    setEventoDiferido(null)
    return eleccion.outcome
  }, [eventoDiferido])

  return {
    yaInstalada,
    esIOS,
    /* true si hay un prompt nativo real esperando (Chrome/Edge/Android). */
    puedeInstalarNativo: eventoDiferido !== null,
    /* Cuándo mostrar el botón en la interfaz: nunca si ya está instalada;
       si no, cuando hay prompt nativo disponible o estamos en iOS (donde se
       muestran instrucciones en vez de un prompt real). */
    mostrarBoton: !yaInstalada && (eventoDiferido !== null || esIOS),
    instalar,
  }
}
