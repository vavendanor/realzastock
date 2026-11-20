-- ============================================================
-- Pedidos de PRUEBA para probar la pantalla de Despachos (T9201 a T9211)
-- ============================================================
-- Necesita la migración 0018 aplicada (columna despacho_programado). NO llevan datos de clientes.
-- Se reconocen a simple vista y se borran todos juntos con despachos_de_prueba_borrar.sql.
--
--   T9201 (2 muebles): T9201-1 SOFÁ fabricado y T9201-2 POLTRONA por fabricar  -> sirve para el despacho PARCIAL
--   T9202  SOFÁ fabricado, Providencia (misma comuna que T9201: salen juntos en la ruta)
--   T9203  SOFÁ EN L fabricado, Ñuñoa
--   T9204  SOFÁ y T9205 POLTRONA fabricados, Las Condes
--   T9206  SOFÁ fabricado con comuna RETIRO TIENDA (grupo "Retiro en tienda")
--   T9207  SOFÁ fabricado sin dirección (grupo "Sin dirección")
--   T9208  SOFÁ fabricado de un pedido CANCELADO (no debe aparecer)
--   T9209  SOFÁ que YA SALIÓ a despacho hoy (se ve en gris en la fecha de hoy)
--   T9210  SOFÁ fabricado, Maipú, ya programado para MAÑANA
--   T9211  POLTRONA por fabricar (no aparece en Despachos)
--
-- Se pueden ejecutar varias veces: lo que ya existe no se duplica. Quedan con fecha de hoy.
-- Mientras existan, cuentan en los totales de Pedidos y del Dashboard. Bórralos al terminar.
-- Cómo ejecutarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

insert into ordenes_fabricacion (
  numero, pedido_numero, shopify_order_id, shopify_line_item_id, unidad,
  tipo, modelo, orientacion, cm, color, tela, comuna,
  pedido_creado_en, origen_shopify,
  estado, listo, listo_en, listo_origen, despachado_en, despacho_programado, cancelado_en
)
select
  v.numero, v.pedido, 'TEST-' || v.pedido, 'TEST-L-' || v.numero, v.unidad,
  v.tipo, v.modelo, v.orientacion, v.cm, v.color, v.tela, v.comuna,
  now() - v.antiguedad, 'prueba',
  v.estado::estado_orden_fabricacion,
  v.estado <> 'por_fabricar',
  case when v.estado <> 'por_fabricar' then now() - interval '1 hour' end,
  case when v.estado <> 'por_fabricar' then 'app' end,
  case when v.estado = 'en_despacho' then now() - interval '30 minutes' end,
  case when v.prog_dias is not null then (now() at time zone 'America/Santiago')::date + v.prog_dias end,
  case when v.cancelado then now() end
from (values
  ('T9201-1', 'T9201', 1, 'SOFÁ',      'OSORNO',    'ninguna', '190 cm',          'CAFE CLARO', 'CUERO BLEND',         'Providencia',   interval '1 hour',  'fabricado',    null::int, false),
  ('T9201-2', 'T9201', 2, 'POLTRONA',  'OSORNO',    'ninguna', 'ESTÁNDAR',        'CAFE CLARO', 'CUERO BLEND',         'Providencia',   interval '1 hour',  'por_fabricar', null,      false),
  ('T9202',   'T9202', 1, 'SOFÁ',      'VALENCIA',  'ninguna', '170 cm',          'CRUDO',      'LINO HIDROREPELENTE', 'Providencia',   interval '2 hours', 'fabricado',    null,      false),
  ('T9203',   'T9203', 1, 'SOFÁ EN L', 'CHILLÁN',   'derecha', '220 cm x 150 cm', 'GRIS',       'LINO HIDROREPELENTE', 'Ñuñoa',         interval '3 hours', 'fabricado',    null,      false),
  ('T9204',   'T9204', 1, 'SOFÁ',      'FRUTILLAR', 'ninguna', '180 cm',          'AZUL MARINO','LINO HIDROREPELENTE', 'Las Condes',    interval '4 hours', 'fabricado',    null,      false),
  ('T9205',   'T9205', 1, 'POLTRONA',  'CHILLÁN',   'ninguna', 'ESTÁNDAR',        'CRUDO',      'LINO HIDROREPELENTE', 'Las Condes',    interval '5 hours', 'fabricado',    null,      false),
  ('T9206',   'T9206', 1, 'SOFÁ',      'OSORNO',    'ninguna', '150 cm',          'BEIGE',      'LINO HIDROREPELENTE', 'RETIRO TIENDA', interval '6 hours', 'fabricado',    null,      false),
  ('T9207',   'T9207', 1, 'SOFÁ',      'VALENCIA',  'ninguna', '200 cm',          'CRUDO',      'LINO HIDROREPELENTE', 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO', interval '7 hours', 'fabricado', null, false),
  ('T9208',   'T9208', 1, 'SOFÁ',      'OSORNO',    'ninguna', '170 cm',          'GRIS',       'LINO HIDROREPELENTE', 'Maipú',         interval '8 hours', 'fabricado',    null,      true),
  ('T9209',   'T9209', 1, 'SOFÁ',      'FRUTILLAR', 'ninguna', '160 cm',          'CRUDO',      'LINO HIDROREPELENTE', 'Vitacura',      interval '9 hours', 'en_despacho',  0,         false),
  ('T9210',   'T9210', 1, 'SOFÁ',      'CHILLÁN',   'ninguna', '175 cm',          'BEIGE',      'LINO HIDROREPELENTE', 'Maipú',         interval '10 hours','fabricado',    1,         false),
  ('T9211',   'T9211', 1, 'POLTRONA',  'VALENCIA',  'ninguna', 'ESTÁNDAR',        'GRIS',       'LINO HIDROREPELENTE', 'Las Condes',    interval '11 hours','por_fabricar', null,      false)
) as v(numero, pedido, unidad, tipo, modelo, orientacion, cm, color, tela, comuna, antiguedad, estado, prog_dias, cancelado)
on conflict (shopify_line_item_id, unidad) do nothing;

-- Qué quedó cargado (esperado: 12 muebles en 11 pedidos).
select numero, pedido_numero, tipo, modelo, estado, comuna, despacho_programado, cancelado_en is not null as cancelado
from ordenes_fabricacion
where shopify_order_id like 'TEST-T92%'
order by numero;
