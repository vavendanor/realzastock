-- ============================================================
-- Pedidos de PRUEBA para probar las pantallas de Pedidos (casillas, "Guardar", conflictos)
-- ============================================================
-- Crea 6 pedidos falsos (T9001 a T9006) que se reconocen a simple vista y se borran
-- todos juntos con pedidos_de_prueba_borrar.sql. NO llevan datos de clientes.
--
--   T9001 (2 muebles: T9001-1 y T9001-2), T9002 y T9003: POR FABRICAR
--   T9004 y T9006: FABRICADO (sirven para "Pasar a en despacho" y para probar conflictos)
--   T9005: EN DESPACHO (sus casillas aparecen bloqueadas)
--
-- Se pueden ejecutar varias veces: lo que ya existe no se duplica. Los pedidos quedan
-- con fecha de hoy, así que aparecen arriba en la lista de Pedidos.
--
-- Identificación (para no mezclarlos con pedidos reales): shopify_order_id empieza con
-- "TEST-" y el origen es "prueba". La sincronización con Shopify no los toca (solo
-- modifica los pedidos que ella misma lee de Shopify).
--
-- Mientras existan, cuentan en los totales de Pedidos y del Dashboard. Bórralos al terminar.
-- Cómo ejecutarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

insert into ordenes_fabricacion (
  numero, pedido_numero, shopify_order_id, shopify_line_item_id, unidad,
  tipo, modelo, orientacion, cm, color, tela, comuna,
  pedido_creado_en, origen_shopify,
  estado, listo, listo_en, listo_origen, despachado_en
)
select
  v.numero, v.pedido, 'TEST-' || v.pedido, 'TEST-L-' || v.numero, v.unidad,
  v.tipo, v.modelo, v.orientacion, v.cm, v.color, v.tela, v.comuna,
  now() - v.antiguedad, 'prueba',
  v.estado::estado_orden_fabricacion,
  v.estado <> 'por_fabricar',
  case when v.estado <> 'por_fabricar' then now() - interval '1 hour' end,
  case when v.estado <> 'por_fabricar' then 'app' end,
  case when v.estado = 'en_despacho' then now() - interval '30 minutes' end
from (values
  ('T9001-1', 'T9001', 1, 'SOFÁ',      'OSORNO',    'ninguna',   '190 cm',        'CAFE CLARO', 'CUERO BLEND',         'Providencia', interval '1 hour',  'por_fabricar'),
  ('T9001-2', 'T9001', 2, 'POLTRONA',  'OSORNO',    'ninguna',   'ESTÁNDAR',      'CAFE CLARO', 'CUERO BLEND',         'Providencia', interval '1 hour',  'por_fabricar'),
  ('T9002',   'T9002', 1, 'SOFÁ EN L', 'VALENCIA',  'derecha',   '215 cm x 150 cm','CRUDO',     'LINO HIDROREPELENTE', 'Ñuñoa',       interval '2 hours', 'por_fabricar'),
  ('T9003',   'T9003', 1, 'SOFÁ',      'CHILLÁN',   'ninguna',   '175 cm',        'GRIS',       'LINO HIDROREPELENTE', 'Las Condes',  interval '3 hours', 'por_fabricar'),
  ('T9004',   'T9004', 1, 'SOFÁ',      'FRUTILLAR', 'ninguna',   '180 cm',        'AZUL MARINO','LINO HIDROREPELENTE', 'Maipú',       interval '4 hours', 'fabricado'),
  ('T9005',   'T9005', 1, 'SOFÁ',      'VALENCIA',  'ninguna',   '170 cm',        'BEIGE',      'LINO HIDROREPELENTE', 'La Reina',    interval '5 hours', 'en_despacho'),
  ('T9006',   'T9006', 1, 'POLTRONA',  'CHILLÁN',   'ninguna',   'ESTÁNDAR',      'CRUDO',      'LINO HIDROREPELENTE', 'Vitacura',    interval '6 hours', 'fabricado')
) as v(numero, pedido, unidad, tipo, modelo, orientacion, cm, color, tela, comuna, antiguedad, estado)
on conflict (shopify_line_item_id, unidad) do nothing;

-- Qué quedó cargado (esperado: 7 muebles en 6 pedidos).
select numero, pedido_numero, tipo, modelo, estado, comuna, origen
from ordenes_fabricacion
where shopify_order_id like 'TEST-%'
order by numero;
