import type { CapacitorConfig } from '@capacitor/cli'

/* APK de bodega: una app nativa (WebView propio, sin Chrome ni barra de dirección) que carga la web de Vercel.
   Cada cambio que se publica en Vercel le llega solo, sin generar otra APK. Solo HTTPS: sin cleartext.
   Las reglas de "solo bodega" viven en la web (src/lib/plataforma.ts) y se activan por Capacitor.isNativePlatform()
   o por el sufijo del user agent de abajo; la web normal no cambia. */
const config: CapacitorConfig = {
  appId: 'cl.realzahogar.stock',
  appName: 'Realza Hogar',
  /* Carpeta que `cap sync` exige; con server.url la app no la usa para mostrar nada. */
  webDir: 'dist',
  server: {
    url: 'https://realzastock.vercel.app',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    appendUserAgent: 'RealzaHogarApp' /* igual a SUFIJO_USER_AGENT_APP de src/lib/plataforma.ts */,
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, backgroundColor: '#FFFFFF' },
    StatusBar: { backgroundColor: '#58402D', style: 'DARK', overlaysWebView: false },
  },
}

export default config
