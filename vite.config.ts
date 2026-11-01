import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    /* Sin esto, `npm run dev` solo escucha en localhost y un celular en la
       misma red no puede llegar al servidor aunque tenga la IP correcta. */
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    /* HTTPS con certificado autofirmado. Es indispensable para probar la
       instalación de la PWA desde otro dispositivo (ej. un celular por
       IP local): los navegadores tratan cualquier origen que no sea
       exactamente "localhost" como inseguro si no es HTTPS, y sin un
       contexto seguro no registran el service worker ni consideran la
       app instalable -- 'beforeinstallprompt' simplemente no se dispara.
       El navegador va a mostrar una advertencia de certificado no
       confiable la primera vez (es autofirmado, no de una entidad
       reconocida); hay que aceptarla ("Avanzado" -> "Continuar de todos
       modos") para poder probar. Esto es solo para desarrollo: en
       producción (Vercel) el certificado es real. */
    basicSsl(),
    VitePWA({
      /* En la APK (`vite build --mode capacitor`) no hay service worker: los
         archivos ya viajan dentro de la app, y un service worker con
         autoUpdate podría dejar versiones viejas en caché tras instalar una
         APK nueva. */
      disable: mode === 'capacitor',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      /* Por defecto el service worker solo se genera en el build de
         producción. Sin él, el navegador nunca considera la app
         "instalable" y 'beforeinstallprompt' no se dispara nunca en
         `npm run dev` -- se activa acá para poder probar el botón de
         instalar sin tener que hacer build cada vez. */
      devOptions: { enabled: true },
      workbox: {
        runtimeCaching: [
          {
            /* Fotos y siluetas del Probador de colores (~0,8 MB). No van en el
               precache general porque solo las usan administración y bodega:
               se descargan al abrir el probador y quedan guardadas para usarlo
               sin conexión. Si se reemplaza una foto, conviene cambiarle el
               nombre; si no, el teléfono puede seguir mostrando la anterior
               hasta 30 días. */
            urlPattern: /\/probador\/.+\.(?:webp|png)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'probador-imagenes',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Realza Hogar - Gestión',
        short_name: 'Realza Hogar',
        description:
          'Sistema de gestión de inventario, ventas y pedidos de Realza Hogar',
        /* nogal-700, el color de marca real (sidebar, panel de login) --
           antes tenía un morado (#7e14ff) puesto solo de placeholder al
           inicializar el proyecto, antes de tener el logo real. */
        theme_color: '#58402D',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
}))
