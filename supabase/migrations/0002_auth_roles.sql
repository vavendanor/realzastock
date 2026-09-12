-- ============================================================
-- Autenticación y roles: Realza Hogar
-- ============================================================
-- Depende de 0001_schema_inicial.sql (tabla usuarios, enum
-- rol_usuario, y el resto de tablas con RLS ya habilitado pero
-- sin políticas).
--
-- Contiene:
--   1) Trigger que crea automáticamente la fila en "usuarios"
--      cuando alguien se registra en auth.users.
--   2) Función helper para leer el rol del usuario autenticado
--      actual, usada por todas las políticas de RLS.
--   3) Políticas de RLS por tabla, según rol.
--
-- Cómo aplicarlo: igual que 0001 — pega este archivo completo
-- en Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Trigger: alta automática en "usuarios" al registrarse
-- ------------------------------------------------------------
-- security definer: el trigger corre con los privilegios de quien
-- lo creó (normalmente el rol postgres, que tiene bypass de RLS),
-- no con los del usuario que se está registrando — si no, la
-- inserción chocaría con las políticas de RLS de "usuarios" que
-- definimos más abajo (un usuario recién creado no es admin).
-- set search_path fijo: evita que alguien manipule el search_path
-- de la sesión para colar un objeto malicioso con el mismo nombre.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usuarios (id, nombre, email, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    new.email,
    'vendedor' -- rol por defecto; el administrador lo cambia manualmente después
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 2) Helper: rol del usuario autenticado actual
-- ------------------------------------------------------------
-- security definer + search_path fijo por la misma razón que
-- arriba: sin esto, esta función quedaría sujeta a las políticas
-- de RLS de "usuarios" que ella misma ayuda a evaluar, generando
-- un ciclo (para saber si puedes leer "usuarios" necesitarías
-- leer "usuarios").
create or replace function public.rol_actual()
returns rol_usuario
language sql
security definer
stable
set search_path = public
as $$
  select rol from public.usuarios where id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 3) Políticas de RLS
-- ------------------------------------------------------------

-- USUARIOS
-- Cada usuario ve su propia fila (para saber su nombre/rol);
-- el administrador ve y gestiona todas.
create policy usuarios_select on usuarios
  for select using (id = auth.uid() or rol_actual() = 'administrador');

create policy usuarios_insert_admin on usuarios
  for insert with check (rol_actual() = 'administrador');

create policy usuarios_update_admin on usuarios
  for update using (rol_actual() = 'administrador');

create policy usuarios_delete_admin on usuarios
  for delete using (rol_actual() = 'administrador');

-- PRODUCTOS
-- Lectura para los tres roles; escritura solo administrador.
create policy productos_select on productos
  for select using (rol_actual() in ('administrador', 'vendedor', 'bodega'));

create policy productos_insert_admin on productos
  for insert with check (rol_actual() = 'administrador');

create policy productos_update_admin on productos
  for update using (rol_actual() = 'administrador');

create policy productos_delete_admin on productos
  for delete using (rol_actual() = 'administrador');

-- VARIANTES (misma lógica que productos)
create policy variantes_select on variantes
  for select using (rol_actual() in ('administrador', 'vendedor', 'bodega'));

create policy variantes_insert_admin on variantes
  for insert with check (rol_actual() = 'administrador');

create policy variantes_update_admin on variantes
  for update using (rol_actual() = 'administrador');

create policy variantes_delete_admin on variantes
  for delete using (rol_actual() = 'administrador');

-- INVENTARIO
-- Lectura para los tres roles; actualización de cantidades para
-- administrador y bodega; alta/baja de filas de stock solo admin.
create policy inventario_select on inventario
  for select using (rol_actual() in ('administrador', 'vendedor', 'bodega'));

create policy inventario_insert_admin on inventario
  for insert with check (rol_actual() = 'administrador');

create policy inventario_update on inventario
  for update using (rol_actual() in ('administrador', 'bodega'));

create policy inventario_delete_admin on inventario
  for delete using (rol_actual() = 'administrador');

-- VENTAS
-- Administrador: todo. Vendedor: crea ventas propias y consulta
-- solo las suyas (no reportes globales). Bodega: sin acceso, no
-- participa en el registro de ventas.
create policy ventas_select on ventas
  for select using (
    rol_actual() = 'administrador'
    or (rol_actual() = 'vendedor' and vendedor_id = auth.uid())
  );

create policy ventas_insert on ventas
  for insert with check (
    rol_actual() = 'administrador'
    or (rol_actual() = 'vendedor' and vendedor_id = auth.uid())
  );

create policy ventas_update_admin on ventas
  for update using (rol_actual() = 'administrador');

create policy ventas_delete_admin on ventas
  for delete using (rol_actual() = 'administrador');

-- VENTA_ITEMS
-- No tiene vendedor_id propio: se valida contra la venta asociada.
create policy venta_items_select on venta_items
  for select using (
    rol_actual() = 'administrador'
    or (
      rol_actual() = 'vendedor'
      and exists (
        select 1 from ventas v
        where v.id = venta_items.venta_id and v.vendedor_id = auth.uid()
      )
    )
  );

create policy venta_items_insert on venta_items
  for insert with check (
    rol_actual() = 'administrador'
    or (
      rol_actual() = 'vendedor'
      and exists (
        select 1 from ventas v
        where v.id = venta_items.venta_id and v.vendedor_id = auth.uid()
      )
    )
  );

create policy venta_items_update_admin on venta_items
  for update using (rol_actual() = 'administrador');

create policy venta_items_delete_admin on venta_items
  for delete using (rol_actual() = 'administrador');

-- PEDIDOS
-- Administrador: todo. Bodega: ve todos los pedidos (los necesita
-- para preparar/despachar) y actualiza su estado. Vendedor: crea
-- pedidos propios y consulta solo los suyos.
create policy pedidos_select on pedidos
  for select using (
    rol_actual() in ('administrador', 'bodega')
    or (rol_actual() = 'vendedor' and responsable_id = auth.uid())
  );

create policy pedidos_insert on pedidos
  for insert with check (
    rol_actual() = 'administrador'
    or (rol_actual() = 'vendedor' and responsable_id = auth.uid())
  );

-- Nota: esta política permite a bodega actualizar la fila completa
-- del pedido (a nivel de RLS solo se controla por fila, no por
-- columna). Si más adelante se quiere impedir que bodega cambie
-- cliente_nombre/cliente_contacto y solo pueda tocar "estado", se
-- puede agregar un trigger que valide qué columnas cambiaron.
create policy pedidos_update on pedidos
  for update using (rol_actual() in ('administrador', 'bodega'));

create policy pedidos_delete_admin on pedidos
  for delete using (rol_actual() = 'administrador');

-- PEDIDO_ITEMS
-- Bodega solo necesita ver el detalle para preparar el pedido,
-- no crear ni editar líneas.
create policy pedido_items_select on pedido_items
  for select using (
    rol_actual() in ('administrador', 'bodega')
    or (
      rol_actual() = 'vendedor'
      and exists (
        select 1 from pedidos p
        where p.id = pedido_items.pedido_id and p.responsable_id = auth.uid()
      )
    )
  );

create policy pedido_items_insert on pedido_items
  for insert with check (
    rol_actual() = 'administrador'
    or (
      rol_actual() = 'vendedor'
      and exists (
        select 1 from pedidos p
        where p.id = pedido_items.pedido_id and p.responsable_id = auth.uid()
      )
    )
  );

create policy pedido_items_update_admin on pedido_items
  for update using (rol_actual() = 'administrador');

create policy pedido_items_delete_admin on pedido_items
  for delete using (rol_actual() = 'administrador');
