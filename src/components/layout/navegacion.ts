import { FileSpreadsheet, LayoutDashboard, Package, Palette, Receipt, Truck, Users, type LucideIcon } from 'lucide-react'
import type { UserRole } from '../../types'

/* Opción de un menú desplegable. `to` es su ruta; la opción se marca como activa en esa ruta
   y en las que cuelgan de ella (por ejemplo "Pedidos" también en /pedidos/:id). */
export interface NavHijo {
  id: string
  label: string
  to: string
  /* Rutas que, además de `to`, la marcan como activa. */
  activaEn: RegExp
}

export interface NavItem {
  id: string
  label: string
  /* Nombre más corto para la barra inferior del celular, donde las etiquetas
     largas no caben. Si falta, se usa `label`. */
  etiquetaCorta?: string
  icon: LucideIcon
  /* Sin `to` ni `hijos`, el módulo todavía no existe: se muestra inerte para
     conservar la estructura del panel del diseño. */
  to?: string
  /* Roles que pueden entrar. Si falta, lo ve cualquier rol. */
  roles?: UserRole[]
  /* Si tiene, el elemento es un desplegable: ya no es un enlace, abre estas opciones. */
  hijos?: NavHijo[]
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/', roles: ['administrador'] },
  { id: 'inventario', label: 'Inventario', icon: Package, to: '/inventario', roles: ['administrador'] },
  { id: 'ventas', label: 'Ventas', icon: Receipt, to: '/ventas', roles: ['administrador', 'vendedor'] },
  {
    id: 'pedidos',
    label: 'Pedidos',
    icon: Truck,
    roles: ['administrador', 'bodega'],
    hijos: [
      { id: 'pedidos', label: 'Pedidos', to: '/pedidos', activaEn: /^\/pedidos(\/|$)/ },
      { id: 'hojas', label: 'Hojas de fabricación', to: '/hojas', activaEn: /^\/hojas(\/|$)/ },
    ],
  },
  {
    id: 'probador',
    label: 'Probador de colores',
    etiquetaCorta: 'Probador',
    icon: Palette,
    to: '/probador',
    roles: ['administrador', 'bodega'],
  },
  { id: 'reporte', label: 'Reporte', icon: FileSpreadsheet, to: '/reporte', roles: ['administrador'] },
  { id: 'usuarios', label: 'Usuarios', icon: Users, to: '/usuarios', roles: ['administrador'] },
]

/* El desplegable (o enlace) está activo si la ruta actual es de alguna de sus opciones. */
export const hijoActivo = (hijo: NavHijo, ruta: string) => hijo.activaEn.test(ruta)
export const itemActivo = (item: NavItem, ruta: string) => (item.hijos ? item.hijos.some((h) => hijoActivo(h, ruta)) : false)

export function navParaRol(rol: UserRole | null): NavItem[] {
  return NAV.filter((item) => !item.roles || (rol !== null && item.roles.includes(rol)))
}

/* A dónde mandar a cada rol al entrar. El administrador no está acá: se
   queda en "/", que es justamente donde vive su Dashboard (ver Inicio.tsx). */
export function rutaInicial(rol: UserRole | null): string | null {
  if (rol === 'vendedor') return '/ventas'
  if (rol === 'bodega') return '/pedidos'
  return null
}

/* Las pantallas de producción: Pedidos (lista y detalle de un mueble) y las hojas de
   fabricación. Los cambios de casillas sin guardar se comparten entre ellas; al salir
   de este grupo se avisa. */
export function esRutaDeProduccion(ruta: string) {
  return /^\/(pedidos|hojas)(\/|$)/.test(ruta)
}
