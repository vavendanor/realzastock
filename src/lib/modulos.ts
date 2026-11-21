import type { UserRole } from '../types'

/* Por ahora la app es solo de producción: la usan administrador y bodega.
   Los módulos comerciales (Inventario, Ventas / pedidos manuales) y el rol vendedor siguen en el código, la
   base de datos y las migraciones, pero están ocultos. Para volver a mostrarlos basta con poner esto en `true`
   (y agregar 'vendedor' a ROLES_ACTIVOS). */
export const MODULOS_COMERCIALES_ACTIVOS = false

/* Los roles que se pueden elegir al crear o editar un usuario y que tienen acceso a la app. */
export const ROLES_ACTIVOS: UserRole[] = ['administrador', 'bodega']

export const rolTieneAcceso = (rol: UserRole | null): boolean => rol !== null && ROLES_ACTIVOS.includes(rol)
