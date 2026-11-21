-- ============================================================
-- Borra los pedidos de PRUEBA del orden y paginador de Despachos (T9300 a T9341)
-- ============================================================
-- Borra SOLO lo creado con despachos_orden_de_prueba_insertar.sql: shopify_order_id que empieza con
-- "TEST-T93" y origen "prueba". Ningún pedido real cumple las dos cosas.
--
-- ANTES de ejecutarlo, en la app: pulsa "Descartar" en la barra de cambios sin guardar (si hay) y
-- cierra las otras pestañas de la app.
--
-- Cómo ejecutarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

-- 1) Si alguna hoja de fabricación incluye estos pedidos, se quitan de ella.
delete from hoja_fabricacion_pedidos where shopify_order_id like 'TEST-T93%';

-- 2) Los pedidos de prueba (sus datos de cliente, si los hubiera, se borran en cascada).
delete from ordenes_fabricacion where shopify_order_id like 'TEST-T93%' and origen_shopify = 'prueba';

-- Comprobación (esperado: 0 y 0).
select
  (select count(*) from ordenes_fabricacion where shopify_order_id like 'TEST-T93%') as pedidos_de_prueba_que_quedan,
  (select count(*) from hoja_fabricacion_pedidos where shopify_order_id like 'TEST-T93%') as en_hojas_que_quedan;
