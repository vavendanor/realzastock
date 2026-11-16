# Pruebas de las hojas de fabricación y del guardado diferido

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
```

- `excelHoja.test.mjs`: reglas de cada celda del Excel, semáforo del plazo (verde, amarillo, rojo) y el
  archivo generado releído celda por celda contra `archivos de contexto/Lista Pendiente 31-10-26.xlsx`.
- `hojasLib.test.mjs`: nombre, validaciones, resumen de pedido y tarjetas de `/hojas`.

## Pantalla real (Chrome)

1. Armar el banco: `node pruebas/arnes/armar.mjs` (crea `preview-tmp/` y `vite.preview-tmp.config.ts`, con un
   Supabase falso que aplica las mismas reglas que las funciones de la migración 0017).
2. Levantarlo: `npx vite --config vite.preview-tmp.config.ts --port 5180 --strictPort`
3. Correr lo que se quiera:

```
node pruebas/hojas/hojaDetalle.ui.mjs          # /hojas/:id: lista, plazo, renombrar, agregar, quitar, eliminar, Excel
node pruebas/hojas/hojas.ui.mjs                # menú, crear hoja, tarjetas, permisos y /reporte
node pruebas/hojas/cambiosPendientes.ui.mjs    # guardado diferido de casillas (4b)
node pruebas/hojas/rutas.ui.mjs                # rutas, botón atrás, 404 y login
```

4. Al terminar: parar el servidor y `node pruebas/arnes/armar.mjs desarmar` (el banco no se sube a Git).

Las hojas de prueba de la base real se borran con `supabase/verificacion/hojas_de_prueba_borrar.sql`.
