import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { esApp } from '../lib/plataforma'

/* Color de la barra de estado del APK: nogal-700, el mismo de la marca. */
const COLOR_BARRA_ESTADO = '#58402D'

/* Comportamiento propio del APK de bodega. En la web normal no hace nada (los plugins ni siquiera se descargan:
   se importan solo si esApp()).
   - Botón "atrás" de Android: navega hacia atrás dentro de la app. Si no hay a dónde volver, minimiza la app en vez de
     cerrarla de golpe. Como pasa por el router, el aviso de "cambios sin guardar" también salta.
   - Barra de estado con el color de la marca.
   Los enlaces externos (otro sitio que no sea realzastock.vercel.app) los abre el sistema en el navegador: es el
   comportamiento por defecto de Capacitor para direcciones que no están en server.url / allowNavigation. */
export function useAppNativa() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!esApp()) return
    let quitar: (() => void) | undefined
    let cancelado = false

    void (async () => {
      try {
        const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
          import('@capacitor/app'),
          import('@capacitor/status-bar'),
          import('@capacitor/splash-screen'),
        ])
        const escucha = await App.addListener('backButton', () => {
          /* React Router guarda en history.state.idx cuántas pantallas hay detrás de esta. */
          const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
          if (idx > 0) navigate(-1)
          else void App.minimizeApp()
        })
        if (cancelado) void escucha.remove()
        else quitar = () => void escucha.remove()

        await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined)
        await StatusBar.setBackgroundColor({ color: COLOR_BARRA_ESTADO }).catch(() => undefined)
        await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined)
        await SplashScreen.hide().catch(() => undefined)
      } catch {
        /* Sin el puente nativo (por ejemplo en una prueba) no hay nada que configurar. */
      }
    })()

    return () => {
      cancelado = true
      quitar?.()
    }
  }, [navigate])
}
