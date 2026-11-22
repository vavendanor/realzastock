import { Capacitor } from '@capacitor/core'

/* Sufijo que el APK agrega al user agent (capacitor.config.ts → android.appendUserAgent). Sirve de respaldo por
   si el puente nativo de Capacitor todavía no se inyectó en la página remota (el APK carga la web de Vercel). */
export const SUFIJO_USER_AGENT_APP = 'RealzaHogarApp'

/* ¿Corre dentro del APK de bodega? En la web normal (navegador o PWA instalada) siempre es false, y ahí nada cambia. */
export function esApp(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return true
  } catch {
    /* sin Capacitor: se mira el user agent */
  }
  return typeof navigator !== 'undefined' && navigator.userAgent.includes(SUFIJO_USER_AGENT_APP)
}
