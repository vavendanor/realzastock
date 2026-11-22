import { LayoutDashboard, Package, Palette, Receipt, Truck, Users, type LucideIcon } from 'lucide-react'
import { MODULOS_COMERCIALES_ACTIVOS, rolTieneAcceso } from '../../lib/modulos'
import { esApp } from '../../lib/plataforma'
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
  /* Módulo comercial (Ventas): solo se muestra si MODULOS_COMERCIALES_ACTIVOS está encendido. */
  comercial?: boolean
  /* Si se muestra en el APK de bodega, que tiene solo el menú de producción. */
  enApp?: boolean
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/', roles: ['administrador'] },
  { id: 'inventario', label: 'Inventario', icon: Package, to: '/inventario', roles: ['administrador'] },
  /* Ventas sigue definido pero oculto mientras los módulos comerciales estén apagados (lib/modulos.ts). */
  { id: 'ventas', label: 'Ventas', icon: Receipt, to: '/ventas', roles: ['administrador', 'vendedor'], comercial: true },
  {
    id: 'pedidos',
    label: 'Pedidos',
    icon: Truck,
    roles: ['administrador', 'bodega'],
    enApp: true,
    hijos: [
      { id: 'pedidos', label: 'Pedidos', to: '/pedidos', activaEn: /^\/pedidos(\/|$)/ },
      { id: 'hojas', label: 'Hojas de fabricación', to: '/hojas', activaEn: /^\/hojas(\/|$)/ },
      { id: 'despachos', label: 'Despachos', to: '/despachos', activaEn: /^\/despachos(\/|$)/ },
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
  { id: 'usuarios', label: 'Usuarios', icon: Users, to: '/usuarios', roles: ['administrador'] },
]

/* El desplegable (o enlace) está activo si la ruta actual es de alguna de sus opciones. */
export const hijoActivo = (hijo: NavHijo, ruta: string) => hijo.activaEn.test(ruta)
export const itemActivo = (item: NavItem, ruta: string) => (item.hijos ? item.hijos.some((h) => hijoActivo(h, ruta)) : false)

/* `enApp`: true dentro del APK de bodega. Ahí solo entra el rol bodega y el menú es solo Pedidos, Hojas de fabricación y
   Despachos. En la web normal no cambia nada. */
export function navParaRol(rol: UserRole | null, enApp: boolean = esApp()): NavItem[] {
  if (enApp) return rol === 'bodega' ? NAV.filter((item) => item.enApp) : []
  if (!rolTieneAcceso(rol)) return []
  return NAV.filter((item) => (!item.comercial || MODULOS_COMERCIALES_ACTIVOS) && (!item.roles || (rol !== null && item.roles.includes(rol))))
}

/* A dónde mandar a cada rol al entrar. El administrador no está acá: se
   queda en "/", que es justamente donde vive su Dashboard (ver Inicio.tsx). */
export function rutaInicial(rol: UserRole | null): string | null {
  /* El vendedor está oculto: no tiene a dónde ir, Inicio le muestra que su cuenta no tiene acceso. */
  if (rol === 'vendedor') return MODULOS_COMERCIALES_ACTIVOS ? '/ventas' : null
  if (rol === 'bodega') return '/pedidos'
  return null
}

/* Dentro del APK solo existen las pantallas de producción (y el inicio, que redirige a Pedidos). El resto -Dashboard,
   Usuarios, Probador, y lo oculto- redirige al inicio. */
export function rutaPermitidaEnApp(ruta: string) {
  return esRutaDeProduccion(ruta)
}

/* Las pantallas de producción: Pedidos (lista y detalle de un mueble), las hojas de
   fabricación y los despachos. Los cambios de casillas sin guardar se comparten entre ellas; al salir
   de este grupo se avisa. */
export function esRutaDeProduccion(ruta: string) {
  return /^\/(pedidos|hojas|despachos)(\/|$)/.test(ruta)
}
