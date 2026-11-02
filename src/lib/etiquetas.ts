import type { EstadoOrden, OrigenOrden } from '../types'

/* Textos de los estados y orígenes de una orden. Viven en un archivo aparte,
   sin acceso a la base de datos, para que también los use la generación del
   Excel (y sus pruebas) sin arrastrar el cliente de Supabase. */

export const ORIGEN_LABEL: Record<OrigenOrden, string> = {
  tienda_en_linea: 'Tienda en línea',
  manual_shopify: 'Manual en Shopify',
}

export const ORDEN_ORIGENES: OrigenOrden[] = ['tienda_en_linea', 'manual_shopify']

export const ESTADO_ORDEN_LABEL: Record<EstadoOrden, string> = {
  por_fabricar: 'Por fabricar',
  fabricado: 'Fabricado',
  en_despacho: 'En despacho',
  entregado: 'Entregado',
}

export const ORDEN_ESTADOS_ORDEN: EstadoOrden[] = ['por_fabricar', 'fabricado', 'en_despacho', 'entregado']
