# Pruebas de hojas de fabricación, despachos y guardado diferido

Son scripts sueltos (no forman parte de la app ni del build). Todos se corren **desde la raíz del proyecto**.

## Preparación (una vez)

```
npm install --no-save puppeteer-core @electric-sql/pglite
```

- Las pruebas de pantalla usan Chrome real (`puppeteer-core`). Si Chrome no está en
  `C:\Program Files\Google\Chrome\Application\chrome.exe`, define la variable `CHROME`.
- `pruebas/arnes/datos.json` son los pedidos reales de octubre de 2026 y **no se sube a Git** (está en
  `pruebas/.gitignore`). Sin ese archivo no se puede armar el banco de pruebas de pantalla, y
  `excelHoja.test.mjs` omite su comparación con octubre.

## Lógica pura (sin navegador ni base de datos)

```
node --import ./pruebas/registrar-ts.mjs pruebas/hojas/excelHoja.test.mjs
node --import ./pruebas/registrar-ts.mjs pruebas/hojas/hojasLib.test.mjs
node --import ./pruebas/registrar-ts.mjs pruebas/app/navegacionApp.test.mjs   # menú y rutas del APK de bodega
node pruebas/app/configApk.test.mjs                                          # capacitor.config, Android y firma
```

- `excelHoja.test.mjs`: reglas de cada celda del Excel, semáforo del plazo (verde, amarillo, rojo) y el
  archivo generado releído celda por celda contra `archivos de contexto/Lista Pendiente 31-10-26.xlsx`.
- `hojasLib.test.mjs`: nombre, validaciones, resumen de pedido y tarjetas de `/hojas`.
- `despachos/despachos.test.mjs`: destinos (comuna, sin dirección, retiro), orden por región, comuna y antigüedad, bloques de
  cada página, filtros (región, comuna, búsqueda), vista por fecha y despachos parciales.
- `paginar.test.mjs`: el paginador (20, 50 y 100 por página, página fuera de rango, lista vacía).

## Base de datos (PGlite: las migraciones reales en Postgres, sin Supabase)

```
node pruebas/despachos/migracion0018.test.mjs     # funciones de la 0018 por rol, disparador, sincronización
node pruebas/despachos/scriptsSql0018.test.mjs    # los SQL de supabase/verificacion (pedidos de prueba y verificación por rol)
node --import ./pruebas/registrar-ts.mjs pruebas/despachos/scriptsSqlOrden.test.mjs   # SQL de pedidos de prueba del orden y paginador, y el orden real de la app sobre ellos
```

## Pantalla real (Chrome)

1. Armar el banco: `node pruebas/arnes/armar.mjs` (crea `preview-tmp/` y `vite.preview-tmp.config.ts`, con un
   Supabase falso que aplica las mismas reglas que las funciones de la migración 0017).
2. Levantarlo: `npx vite --config vite.preview-tmp.config.ts --port 5180 --strictPort`
3. Correr lo que se quiera:

```
node pruebas/hojas/hojaDetalle.ui.mjs          # /hojas/:id: lista, plazo, renombrar, agregar, quitar, eliminar, Excel
node pruebas/despachos/despachos.ui.mjs      # /despachos: grupos, programar, por fecha, quitar, despachar, comprobante
node pruebas/despachos/despachosOrden.ui.mjs # /despachos: orden por región/comuna/antigüedad, paginador, selección y cambios pendientes entre páginas
node pruebas/despachos/despachosFiltros.ui.mjs # /despachos: filtros de región, comuna y N° de pedido, grupos especiales, selección "fuera del filtro"
node pruebas/pedidos/paginador.ui.mjs        # /pedidos y /hojas/nueva: paginador con filtros, cambios pendientes y celular
node pruebas/hojas/hojas.ui.mjs                # menú, crear hoja, tarjetas, permisos y planilla de pedidos del Dashboard
node pruebas/hojas/cambiosPendientes.ui.mjs    # guardado diferido de casillas (4b)
node pruebas/hojas/rutas.ui.mjs                # rutas, botón atrás, 404 y login
node pruebas/app/app.ui.mjs                    # APK de bodega (user agent con sufijo): solo bodega, menú y rutas; la web normal no cambia
```

4. Al terminar: parar el servidor y `node pruebas/arnes/armar.mjs desarmar` (el banco no se sube a Git).

Los datos de prueba de la base real se borran con `supabase/verificacion/hojas_de_prueba_borrar.sql` (hojas PRUEBA)
`supabase/verificacion/despachos_de_prueba_borrar.sql` (pedidos T9201 a T9211) y
`supabase/verificacion/despachos_orden_de_prueba_borrar.sql` (pedidos T9300 a T9341).
