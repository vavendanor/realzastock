-- ============================================================
-- Borrar los datos de prueba (productos, stock, ventas y pedidos)
-- ============================================================
-- Depende de 0001 a 0010.
--
-- El cliente cambió el rumbo del sistema: pasa a ser una herramienta de
-- producción (órdenes de fabricación desde Shopify + stock de telas). Los
-- productos, variantes, inventario, ventas y pedidos que hay hoy son datos
-- de prueba inventados, y se borran antes de cargar datos reales.
--
-- CONSERVA: usuarios (tabla "usuarios" y cuentas de auth.users).
-- BORRA: pedido_items, pedidos, venta_items, ventas, inventario, variantes
-- y productos. Es IRREVERSIBLE: antes de ejecutarla, corre la consulta de
-- conteos que te pasó Claude y confirma que lo que se va a borrar es lo
-- que esperas.
--
-- Orden (por las claves foráneas):
--   1) pedido_items   -> apunta a pedidos y variantes (variante SIN cascade).
--   2) pedidos        -> pedidos.venta_id apunta a ventas con "restrict":
--                        hay que borrar los pedidos ANTES que las ventas.
--   3) venta_items    -> apunta a ventas y variantes (variante SIN cascade).
--   4) ventas
--   5) inventario     -> apunta a variantes (con cascade, se borra explícito
--                        por claridad).
--   6) variantes      -> apunta a productos. El trigger de 0003 intenta
--                        borrar el producto cuando se queda sin variantes;
--                        no molesta, el paso 7 limpia lo que quede.
--   7) productos
--
-- Nada de esto se puede deshacer, pero la operación es atómica: si algún
-- DELETE falla, la transacción entera se revierte y no queda nada a medias.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

begin;

delete from pedido_items;
delete from pedidos;
delete from venta_items;
delete from ventas;
delete from inventario;
delete from variantes;
delete from productos;

-- Verificación: todo lo borrado debe quedar en 0, y usuarios intacta.
-- Si algo no cuadra, el "raise" revierte la transacción completa.
do $$
declare
  v_restante integer;
begin
  select
    (select count(*) from pedido_items) +
    (select count(*) from pedidos) +
    (select count(*) from venta_items) +
    (select count(*) from ventas) +
    (select count(*) from inventario) +
    (select count(*) from variantes) +
    (select count(*) from productos)
  into v_restante;

  if v_restante <> 0 then
    raise exception 'Quedaron % filas sin borrar; se revierte todo.', v_restante;
  end if;

  if not exists (select 1 from usuarios where rol = 'administrador') then
    raise exception 'No hay ningún administrador en usuarios; se revierte todo.';
  end if;
end;
$$;

commit;

-- Resultado a revisar después de ejecutarla (debe dar 0 en todo menos usuarios):
select
  (select count(*) from usuarios)    as usuarios,
  (select count(*) from productos)   as productos,
  (select count(*) from variantes)   as variantes,
  (select count(*) from inventario)  as inventario,
  (select count(*) from ventas)      as ventas,
  (select count(*) from venta_items) as venta_items,
  (select count(*) from pedidos)     as pedidos,
  (select count(*) from pedido_items) as pedido_items;
