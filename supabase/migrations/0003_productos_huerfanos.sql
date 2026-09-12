-- ============================================================
-- Productos huérfanos: limpieza y prevención
-- ============================================================
-- Depende de 0001_schema_inicial.sql y 0002_auth_roles.sql.
--
-- Contexto: hasta ahora, al eliminar la última variante de un
-- producto, el producto quedaba en la tabla `productos` sin
-- ninguna variante asociada. El borrado ya se corrigió en la
-- aplicación (src/lib/inventario.ts), pero quedan filas
-- huérfanas de las pruebas anteriores.
--
-- Este archivo tiene DOS partes independientes. Puedes aplicar
-- solo la parte 1 si prefieres no agregar comportamiento
-- automático a la base de datos.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run,
-- igual que las migraciones anteriores.
-- ============================================================


-- ------------------------------------------------------------
-- PASO PREVIO (recomendado): mirar qué se va a borrar
-- ------------------------------------------------------------
-- Ejecuta SOLO esta consulta primero, revisa el resultado, y
-- recién después corre el DELETE de la parte 1.
--
--   select p.id, p.modelo, p.descripcion, p.creado_en
--   from productos p
--   where not exists (select 1 from variantes v where v.producto_id = p.id)
--   order by p.creado_en;
--
-- Si devuelve 0 filas, no hay nada que limpiar y puedes saltarte
-- la parte 1 directamente.


-- ------------------------------------------------------------
-- PARTE 1: limpieza de los huérfanos existentes
-- ------------------------------------------------------------
-- Un producto sin variantes no tiene nada vendible asociado: no
-- aparece en el inventario (el listado parte desde `variantes`),
-- pero sí ensucia cualquier vista que liste productos.
-- Es idempotente: correrlo dos veces no hace daño.
delete from productos p
where not exists (
  select 1 from variantes v where v.producto_id = p.id
);


-- ------------------------------------------------------------
-- PARTE 2 (opcional): evitar que vuelvan a aparecer
-- ------------------------------------------------------------
-- La corrección en la aplicación cubre el borrado hecho desde el
-- panel, pero no el que se haga desde el Table Editor de Supabase,
-- desde un script, o desde código futuro (por ejemplo, el módulo
-- móvil de bodega). Este trigger mueve la regla a la base de datos,
-- donde se cumple siempre y dentro de la misma transacción.
--
-- Ten en cuenta el efecto secundario: si borras una variante desde
-- el Table Editor y era la última, su producto desaparecerá solo.
-- Si prefieres que eso no ocurra nunca de forma automática, no
-- apliques esta parte.
create or replace function public.eliminar_producto_sin_variantes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.variantes where producto_id = old.producto_id
  ) then
    delete from public.productos where id = old.producto_id;
  end if;
  return old;
end;
$$;

-- Nota sobre el borrado en cascada: al eliminar un producto, la FK
-- `variantes.producto_id ... on delete cascade` borra sus variantes y
-- cada una dispara este trigger. El DELETE de adentro no encuentra
-- la fila (ya la está borrando la sentencia externa), afecta 0 filas
-- y no se produce recursión.
create trigger variantes_limpiar_producto_huerfano
  after delete on variantes
  for each row execute function public.eliminar_producto_sin_variantes();
