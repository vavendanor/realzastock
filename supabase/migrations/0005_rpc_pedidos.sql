-- ============================================================
-- RPC: crear pedidos y avanzar su estado de forma atómica
-- ============================================================
-- Depende de 0001, 0002, 0003 y 0004.
--
-- Decisiones de negocio detrás de estas funciones (confirmadas
-- con el dueño del proyecto antes de escribir esto):
--
--   1) Crear un pedido NO descuenta stock. Un pedido es una
--      promesa, no un movimiento de inventario todavía. Sí se
--      valida que exista stock suficiente (sumando bodega +
--      showroom) para no prometer algo que no hay.
--
--   2) El stock se descuenta recién cuando el pedido pasa a
--      "despachado" — el momento en que la unidad físicamente
--      sale de bodega o showroom. Si en ese momento ya no
--      alcanza (por ejemplo, se vendió por otro canal mientras
--      el pedido esperaba), la transición se rechaza.
--
--   3) El estado solo avanza de a un paso: pendiente ->
--      en_preparacion -> despachado -> entregado. No se puede
--      saltar directo a "entregado" ni retroceder. Por eso la
--      función no recibe el estado destino: ella misma calcula
--      cuál es el único estado siguiente válido.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- crear_pedido(cliente_nombre, cliente_contacto, items)
-- ------------------------------------------------------------
-- `p_items` es un arreglo JSON: [{"variante_id": "uuid", "cantidad": 2}, ...]
-- Devuelve el id del pedido creado.
create or replace function public.crear_pedido(
  p_cliente_nombre text,
  p_cliente_contacto text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol rol_usuario;
  v_pedido_id uuid;
  v_item jsonb;
  v_variante_id uuid;
  v_cantidad integer;
  v_disponible integer;
  v_sku text;
begin
  v_rol := rol_actual();

  if v_rol is null then
    raise exception 'Debes iniciar sesión para crear un pedido.'
      using errcode = '28000';
  end if;

  if v_rol not in ('administrador', 'vendedor') then
    raise exception 'El rol % no puede crear pedidos.', v_rol
      using errcode = '42501';
  end if;

  if p_cliente_nombre is null or btrim(p_cliente_nombre) = '' then
    raise exception 'El pedido necesita el nombre del cliente.'
      using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.'
      using errcode = '22023';
  end if;

  -- El vendedor responsable es siempre quien llama: igual que en
  -- registrar_venta, no se acepta como parámetro para que nadie
  -- registre pedidos a nombre de otro vendedor.
  insert into pedidos (responsable_id, cliente_nombre, cliente_contacto, estado)
  values (auth.uid(), btrim(p_cliente_nombre), nullif(btrim(p_cliente_contacto), ''), 'pendiente')
  returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variante_id := (v_item->>'variante_id')::uuid;
    v_cantidad := (v_item->>'cantidad')::integer;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor que cero.'
        using errcode = '22023';
    end if;

    select sku into v_sku from variantes where id = v_variante_id;

    if not found then
      raise exception 'La variante indicada no existe.'
        using errcode = '23503';
    end if;

    -- Solo se valida disponibilidad combinada (bodega + showroom): en
    -- qué ubicación se despacha se decide después, al preparar el
    -- pedido. No se bloquea (no `for update`) porque nada se descuenta
    -- todavía: es una foto del momento, no una reserva.
    select coalesce(sum(cantidad), 0) into v_disponible
    from inventario
    where variante_id = v_variante_id;

    if v_disponible < v_cantidad then
      raise exception 'Stock insuficiente para %: hay % en total (bodega + showroom) y se pidieron %.',
        v_sku, v_disponible, v_cantidad
        using errcode = 'P0001';
    end if;

    insert into pedido_items (pedido_id, variante_id, cantidad)
    values (v_pedido_id, v_variante_id, v_cantidad);
  end loop;

  return v_pedido_id;
end;
$$;

revoke all on function public.crear_pedido(text, text, jsonb) from anon;
grant execute on function public.crear_pedido(text, text, jsonb) to authenticated;


-- ------------------------------------------------------------
-- avanzar_estado_pedido(pedido_id, ubicacion)
-- ------------------------------------------------------------
-- Mueve el pedido a su único estado siguiente válido. `p_ubicacion`
-- solo es obligatorio para la transición a "despachado" (de ahí
-- sale el stock); se ignora en las demás.
--
-- Limitación conocida: si el pedido tiene varias líneas, todas se
-- descuentan de la MISMA ubicación. Despachar un pedido dividido
-- entre bodega y showroom no está soportado todavía.
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

  -- `for update` bloquea el pedido hasta el fin de la transacción:
  -- evita que dos personas avancen el mismo pedido a la vez y lo
  -- salten dos estados.
  select estado into v_estado_actual
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

  if v_estado_siguiente = 'despachado' then
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
      fecha_actualizacion = now()
  where id = p_pedido_id;

  return v_estado_siguiente;
end;
$$;

revoke all on function public.avanzar_estado_pedido(uuid, ubicacion_stock) from anon;
grant execute on function public.avanzar_estado_pedido(uuid, ubicacion_stock) to authenticated;
