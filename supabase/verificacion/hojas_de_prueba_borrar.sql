-- ============================================================
-- Borra las hojas de fabricación de PRUEBA
-- ============================================================
-- Borra SOLO las hojas cuyo nombre empieza con "PRUEBA" (en mayúsculas, como se
-- escribe al crearlas). Las hojas reales no se tocan. Los pedidos no se borran: solo
-- se deshace su pertenencia a esas hojas.
--
-- Cómo ejecutarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

-- 1) Los pedidos que esas hojas tenían asignados.
delete from hoja_fabricacion_pedidos
where hoja_id in (select id from hojas_fabricacion where nombre like 'PRUEBA%');

-- 2) Las hojas de prueba.
delete from hojas_fabricacion where nombre like 'PRUEBA%';

-- Comprobación (esperado: 0 y 0).
select
  (select count(*) from hojas_fabricacion where nombre like 'PRUEBA%') as hojas_de_prueba_que_quedan,
  (select count(*) from hoja_fabricacion_pedidos
    where hoja_id not in (select id from hojas_fabricacion)) as pedidos_huerfanos;
