-- ============================================================
-- Registrar cuándo y desde dónde se despachó un pedido
-- ============================================================
-- Depende de 0001 a 0009.
--
-- Hasta ahora el sistema solo guardaba la fecha del ÚLTIMO cambio de
-- estado (fecha_actualizacion), así que la fecha de despacho se perdía
-- al pasar a "entregado", y la ubicación desde la que salió la mercadería
-- no se guardaba en ninguna parte (solo se usaba para descontar stock).
-- El comprobante de despacho necesita ambos datos.
--
-- Cambios:
--   1) pedidos.despachado_en: momento en que el pedido pasó a "despachado".
--   2) pedidos.despachado_desde: ubicación de la que salió el stock.
--      Queda NULL en los pedidos basados en una venta: ahí no se descontó
--      stock al despachar (ya se descontó al vender), así que no hay una
--      ubicación de despacho que registrar.
--   3) avanzar_estado_pedido rellena ambas al pasar a "despachado".
--
-- Los pedidos que ya estaban despachados o entregados NO se tocan: quedan
-- con NULL (el dato original no existe, y no se inventa). El comprobante
-- los sigue resolviendo como antes.
--
-- Orden: aplica esta migración ANTES de publicar el frontend nuevo, porque
-- el listado de pedidos pasa a leer estas columnas.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Columnas nuevas
-- ------------------------------------------------------------
alter table pedidos
  add column if not exists despachado_en timestamptz,
  add column if not exists despachado_desde ubicacion_stock;


-- ------------------------------------------------------------
-- 2) avanzar_estado_pedido: registrar el despacho
-- ------------------------------------------------------------
-- Misma firma que en 0005/0008: se reemplaza en el lugar. Lo único que
-- cambia es el UPDATE final, que ahora también guarda despachado_en y
-- despachado_desde cuando la transición es hacia "despachado".
create or replace function public.avanzar_estado_pedido(
  p_pedido_id uuid,
  p_ubicacion ubicacion_stock default null
)
returns estado_pedido
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol rol_usuario;
  v_estado_actual estado_pedido;
  v_estado_siguiente estado_pedido;
  v_venta_id uuid;
  v_item record;
  v_disponible integer;
begin
  v_rol := rol_actual();

  if v_rol is null then
    raise exception 'Debes iniciar sesión.'
      using errcode = '28000';
  end if;

  if v_rol not in ('administrador', 'bodega') then
    raise exception 'El rol % no puede cambiar el estado de un pedido.', v_rol
      using errcode = '42501';
  end if;

  select estado, venta_id into v_estado_actual, v_venta_id
  from pedidos
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido indicado no existe.'
      using errcode = '23503';
  end if;

  v_estado_siguiente := case v_estado_actual
    when 'pendiente' then 'en_preparacion'
    when 'en_preparacion' then 'despachado'
    when 'despachado' then 'entregado'
    when 'entregado' then null
  end;

  if v_estado_siguiente is null then
    raise exception 'El pedido ya está entregado: no hay un estado siguiente.'
      using errcode = 'P0001';
  end if;

  -- Con venta_id el stock ya se descontó al vender: despachar solo
  -- cambia el estado, y p_ubicacion se ignora.
  if v_estado_siguiente = 'despachado' and v_venta_id is null then
    if p_ubicacion is null then
      raise exception 'Indica desde dónde se despacha (bodega o showroom).'
        using errcode = '22023';
    end if;

    for v_item in select variante_id, cantidad from pedido_items where pedido_id = p_pedido_id
    loop
      select cantidad into v_disponible
      from inventario
      where variante_id = v_item.variante_id and ubicacion = p_ubicacion
      for update;

      if not found then
        v_disponible := 0;
      end if;

      if v_disponible < v_item.cantidad then
        raise exception 'Stock insuficiente en % para despachar este pedido: hay % y se necesitan %.',
          p_ubicacion, v_disponible, v_item.cantidad
          using errcode = 'P0001';
      end if;

      update inventario
      set cantidad = cantidad - v_item.cantidad,
          actualizado_en = now()
      where variante_id = v_item.variante_id and ubicacion = p_ubicacion;
    end loop;
  end if;

  update pedidos
  set estado = v_estado_siguiente,
      fecha_actualizacion = now(),
      -- Solo al pasar a "despachado". En cualquier otra transición se
      -- conservan los valores que ya tenía (el flujo es lineal, así que
      -- el pedido pasa por "despachado" una sola vez).
      despachado_en = case when v_estado_siguiente = 'despachado' then now() else despachado_en end,
      -- Sin venta: la ubicación de la que se descontó el stock. Con venta:
      -- queda NULL, porque en el despacho no se movió stock.
      despachado_desde = case
        when v_estado_siguiente = 'despachado' and v_venta_id is null then p_ubicacion
        else despachado_desde
      end
  where id = p_pedido_id;

  return v_estado_siguiente;
end;
$$;

revoke execute on function public.avanzar_estado_pedido(uuid, ubicacion_stock) from public, anon;
grant execute on function public.avanzar_estado_pedido(uuid, ubicacion_stock) to authenticated;
