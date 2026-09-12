import { LayoutDashboard, Package, Receipt, Truck, Users, type LucideIcon } from 'lucide-react'
import type { UserRole } from '../../types'

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  /* Sin `to`, el módulo todavía no existe: se muestra inerte para conservar
     la estructura del panel del diseño. */
  to?: string
  /* Roles que pueden entrar. Si falta, lo ve cualquier rol. */
  roles?: UserRole[]
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/', roles: ['administrador'] },
  { id: 'inventario', label: 'Inventario', icon: Package, to: '/inventario', roles: ['administrador'] },
  { id: 'ventas', label: 'Ventas', icon: Receipt, to: '/ventas', roles: ['administrador', 'vendedor'] },
  { id: 'pedidos', label: 'Pedidos', icon: Truck, to: '/pedidos', roles: ['administrador', 'bodega', 'vendedor'] },
  { id: 'usuarios', label: 'Usuarios', icon: Users, to: '/usuarios', roles: ['administrador'] },
]

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
