# Realza Hogar - Sistema de Gestión

PWA para la gestión de inventario, ventas y pedidos de **Realza Hogar**, tienda de sofás con venta online (Shopify) y showroom físico en Santiago Centro, Chile.

Una misma base de código sirve dos experiencias:

- **Web completa**: panel de administración (inventario, ventas, pedidos, usuarios, reportes) para el dueño/administrador.
- **App (PWA acotada)**: vista reducida para el uso diario de vendedores y personal de bodega/despacho (consulta de stock, registro de ventas, estado de pedidos), instalable desde el navegador.

## Stack

- **Frontend**: React + Vite + TypeScript
- **PWA**: vite-plugin-pwa (instalable, service worker)
- **Estilos**: Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Edge Functions) — _pendiente de conectar_
- **Deploy**: Vercel

## Roles de usuario

- Dueño / administrador
- Vendedor
- Bodega / despacho

## Estructura del proyecto

```
src/
  components/   componentes de UI reutilizables
  pages/        vistas/rutas de la aplicación
  lib/          utilidades, clientes de servicios (ej. Supabase, futuro)
  types/        tipos e interfaces de TypeScript compartidos
  hooks/        hooks de React personalizados
public/         estáticos e iconos de la PWA
```

## Requisitos

- Node.js 20+ y npm

## Cómo correr el proyecto

```bash
npm install
npm run dev
```

Otros comandos disponibles:

```bash
npm run build     # build de producción
npm run preview   # sirve el build localmente
npm run lint      # linting con oxlint
```

## Estado actual

Proyecto inicializado con Vite + React + TypeScript, Tailwind CSS y configuración PWA básica (manifest e iconos placeholder). La conexión a Supabase (base de datos, autenticación y roles) se implementa en una etapa posterior.
