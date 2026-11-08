-- ============================================================
-- Borra los pedidos de PRUEBA creados con pedidos_de_prueba_insertar.sql
-- ============================================================
-- Borra SOLO lo que es de prueba: shopify_order_id que empieza con "TEST-" y origen
-- "prueba". Ningún pedido real cumple las dos cosas.
--
-- ANTES de ejecutarlo, en la app: pulsa "Descartar" en la barra de cambios sin guardar
-- (si hay) y cierra las otras pestañas de la app. Si quedaran cambios pendientes de un
-- pedido que ya no existe, la app los marcaría como "no se pueden guardar".
--
-- Cómo ejecutarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

-- 1) Si alguna hoja de fabricación incluye pedidos de prueba, se quitan de ella.
delete from hoja_fabricacion_pedidos where shopify_order_id like 'TEST-%';

-- 2) Los pedidos de prueba (sus datos de cliente, si los hubiera, se borran en cascada).
delete from ordenes_fabricacion where shopify_order_id like 'TEST-%' and origen_shopify = 'prueba';

-- Comprobación (esperado: 0 y 0).
select
  (select count(*) from ordenes_fabricacion where shopify_order_id like 'TEST-%') as pedidos_de_prueba_que_quedan,
  (select count(*) from hoja_fabricacion_pedidos where shopify_order_id like 'TEST-%') as en_hojas_que_quedan;
