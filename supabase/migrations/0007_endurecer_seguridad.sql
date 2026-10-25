-- ============================================================
-- Endurecer seguridad: cerrar atajos que saltan las reglas
-- ============================================================
-- Depende de 0001 a 0006.
--
-- Contexto: las funciones RPC (registrar_venta, crear_pedido,
-- avanzar_estado_pedido) validan stock, toman el precio del
-- catálogo y respetan el flujo de estados. Pero las políticas de
-- RLS de 0002 seguían permitiendo escribir DIRECTO en las tablas
-- por la API, sin pasar por esas funciones:
--   - un vendedor podía insertar ventas/venta_items con el precio
--     que quisiera y sin descontar stock, o pedidos sin validar stock;
--   - bodega podía hacer UPDATE a cualquier columna de un pedido,
--     por ejemplo saltar a "entregado" sin pasar por "despachado"
--     (y así nunca se descontaba el stock).
-- Las RPC son SECURITY DEFINER, así que no necesitan estos permisos:
-- se pueden quitar sin romper nada de la app.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Ventas y pedidos: solo se crean por las funciones RPC
-- ------------------------------------------------------------
-- El administrador conserva la escritura directa para poder
-- corregir datos a mano si hiciera falta.
drop policy if exists ventas_insert on ventas;
create policy ventas_insert_admin on ventas
  for insert with check (rol_actual() = 'administrador');

drop policy if exists venta_items_insert on venta_items;
create policy venta_items_insert_admin on venta_items
  for insert with check (rol_actual() = 'administrador');

drop policy if exists pedidos_insert on pedidos;
create policy pedidos_insert_admin on pedidos
  for insert with check (rol_actual() = 'administrador');

drop policy if exists pedido_items_insert on pedido_items;
create policy pedido_items_insert_admin on pedido_items
  for insert with check (rol_actual() = 'administrador');


-- ------------------------------------------------------------
-- 2) Pedidos: bodega cambia el estado solo vía la función
-- ------------------------------------------------------------
-- avanzar_estado_pedido sigue funcionando para bodega (corre con
-- sus propios permisos y valida el rol ella misma).
drop policy if exists pedidos_update on pedidos;
create policy pedidos_update_admin on pedidos
  for update using (rol_actual() = 'administrador');


-- ------------------------------------------------------------
-- 3) Permisos de ejecución de las funciones RPC
-- ------------------------------------------------------------
-- El "revoke ... from anon" de 0004/0005/0006 no tenía efecto:
-- en Postgres toda función nueva queda ejecutable por PUBLIC, y
-- anon hereda de ahí. No era explotable (las funciones rechazan a
-- quien no tiene rol), pero así queda como se pretendía.
revoke execute on function public.registrar_venta(canal_venta, ubicacion_stock, jsonb) from public, anon;
grant execute on function public.registrar_venta(canal_venta, ubicacion_stock, jsonb) to authenticated;

revoke execute on function public.crear_pedido(text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.crear_pedido(text, text, text, text, text, text, text, jsonb) to authenticated;

revoke execute on function public.avanzar_estado_pedido(uuid, ubicacion_stock) from public, anon;
grant execute on function public.avanzar_estado_pedido(uuid, ubicacion_stock) to authenticated;
-- rol_actual() se deja como está a propósito: las políticas de RLS
-- la evalúan con el rol de quien consulta, así que necesita seguir
-- siendo ejecutable por todos.


-- ------------------------------------------------------------
-- 4) Nunca dejar el sistema sin administradores
-- ------------------------------------------------------------
-- La pantalla de Usuarios no deja que alguien se cambie su propio
-- rol, pero la base sí permitía quitarle el rol (o borrar) al
-- último administrador, y entonces nadie podría volver a gestionar
-- usuarios. Esto también cubre el borrado en cascada desde
-- auth.users.
create or replace function public.proteger_ultimo_administrador()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.rol = 'administrador'
     and (tg_op = 'DELETE' or new.rol <> 'administrador')
     and not exists (
       select 1 from public.usuarios
       where rol = 'administrador' and id <> old.id
     )
  then
    raise exception 'No se puede quitar el rol (ni eliminar) al último administrador del sistema.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists usuarios_proteger_ultimo_admin on usuarios;
create trigger usuarios_proteger_ultimo_admin
  before update of rol or delete on usuarios
  for each row execute function public.proteger_ultimo_administrador();
