-- ============================================================
-- Pedidos de PRUEBA para probar el ORDEN y el PAGINADOR de Despachos (T9300 a T9341)
-- ============================================================
-- Necesita la migración 0018 aplicada. NO llevan datos de clientes. Se borran todos juntos con
-- despachos_orden_de_prueba_borrar.sql. Son más de 20 muebles fabricados a propósito: con 20 por página
-- hay dos páginas, y un grupo (Antofagasta) queda cortado entre ambas.
--
--   T9300 a T9335 (36 muebles fabricados): 6 por comuna, repartidos en 4 regiones
--       Metropolitana de Santiago: Providencia, Ñuñoa, Las Condes
--       Valparaíso: Viña del Mar    Biobío: Concepción    Antofagasta: Antofagasta
--     Cada pedido tiene una antigüedad distinta (entre 2 y 37 días) y el número de pedido NO coincide con la
--     antigüedad: dentro de cada comuna, el orden por antigüedad se distingue del orden por número.
--   T9336  Puerto Montt (región de Los Lagos: queda entre Biobío y Valparaíso)
--   T9337  RETIRO TIENDA                      T9338  sin dirección
--   T9339  pedido CANCELADO (no aparece)      T9340  por fabricar (no aparece)
--   T9341  Providencia, pedido de hace 40 días PERO con el inicio del plazo cambiado a ayer: cuenta como
--          el más NUEVO de su comuna (queda al final de Providencia).
--
-- Se pueden ejecutar varias veces: lo que ya existe no se duplica. Mientras existan, cuentan en los totales de
-- Pedidos y del Dashboard. Bórralos al terminar.
-- Cómo ejecutarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

insert into ordenes_fabricacion (
  numero, pedido_numero, shopify_order_id, shopify_line_item_id, unidad,
  tipo, modelo, orientacion, cm, color, tela, comuna,
  pedido_creado_en, plazo_desde, origen_shopify,
  estado, listo, listo_en, listo_origen, cancelado_en
)
select
  'T' || (9300 + v.n), 'T' || (9300 + v.n), 'TEST-T' || (9300 + v.n), 'TEST-L-T' || (9300 + v.n), 1,
  'SOFÁ', 'OSORNO', 'ninguna', '170 cm', 'CRUDO', 'LINO HIDROREPELENTE', v.comuna,
  now() - make_interval(days => v.dias), v.plazo_desde, 'prueba',
  v.estado::estado_orden_fabricacion,
  v.estado <> 'por_fabricar',
  case when v.estado <> 'por_fabricar' then now() - interval '1 hour' end,
  case when v.estado <> 'por_fabricar' then 'app' end,
  case when v.cancelado then now() end
from (
  -- 36 muebles en 6 comunas; la antigüedad (2 a 37 días) está "revuelta" respecto del número de pedido
  select n, (array['Providencia', 'Ñuñoa', 'Las Condes', 'Viña del Mar', 'Concepción', 'Antofagasta'])[(n % 6) + 1] as comuna,
         ((n * 11) % 36) + 2 as dias, null::date as plazo_desde, 'fabricado' as estado, false as cancelado
  from generate_series(0, 35) as n
  union all select 36, 'Puerto Montt', 12, null, 'fabricado', false
  union all select 37, 'RETIRO TIENDA', 9, null, 'fabricado', false
  union all select 38, 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO', 8, null, 'fabricado', false
  union all select 39, 'Providencia', 7, null, 'fabricado', true
  union all select 40, 'Providencia', 6, null, 'por_fabricar', false
  union all select 41, 'Providencia', 40, (now() at time zone 'America/Santiago')::date - 1, 'fabricado', false
) as v(n, comuna, dias, plazo_desde, estado, cancelado)
on conflict (shopify_line_item_id, unidad) do nothing;

-- Qué quedó cargado (esperado: 42 muebles; 40 esperan entrega y salen en Despachos).
select numero, comuna, region, estado, fecha_pedido, plazo_desde, cancelado_en is not null as cancelado
from ordenes_fabricacion
where shopify_order_id like 'TEST-T93%'
order by region nulls last, comuna, coalesce(plazo_desde, fecha_pedido), numero;
