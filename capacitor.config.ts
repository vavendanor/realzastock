import type { CapacitorConfig } from '@capacitor/cli'

/* Sin `server.url`: la APK empaqueta los archivos de `dist` y no carga el
   sitio de Vercel. Usa el mismo Supabase porque las variables VITE_ se
   incrustan al compilar. */
const config: CapacitorConfig = {
  appId: 'com.realzahogar.panel',
  appName: 'Realza Hogar',
  webDir: 'dist',
}

export default config
