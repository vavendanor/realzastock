-- ============================================================
-- Pedido basado en una venta existente
-- ============================================================
-- Depende de 0001 a 0007.
--
-- Problema que resuelve: una venta con despacho obligaba a registrar
-- lo mismo dos veces (venta + pedido) y el stock se descontaba dos
-- veces: al vender (registrar_venta) y al despachar
-- (avanzar_estado_pedido). Ahora un pedido puede nacer de una venta:
--   - los productos y cantidades se copian de la venta en el servidor;
--   - el precio al que se vendió se copia a pedido_items, para que lo
--     vean todos los roles (bodega no puede leer ventas por RLS);
--   - al despachar, NO se vuelve a descontar stock (ya se descontó);
--   - una venta puede tener un solo pedido.
-- Los pedidos sin venta funcionan exactamente igual que antes.
--
-- Orden: aplica esta migración ANTES de publicar el frontend nuevo.
-- (El frontend viejo sigue funcionando con la migración aplicada.)
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Columnas nuevas
-- ------------------------------------------------------------
-- on delete restrict: no se puede borrar una venta que ya tiene
-- pedido. Si se permitiera, el pedido quedaría con venta_id nulo y
-- volvería a descontar stock al despacharse.
alter table pedidos
  add column if not exists venta_id uuid references ventas(id) on delete restrict;

-- Un índice único permite varios nulos (los pedidos sin venta) pero
-- impide que dos pedidos apunten a la misma venta, aun con dos
-- llamadas simultáneas.
create unique index if not exists pedidos_venta_id_unico on pedidos (venta_id);

-- Precio al que se vendió, copiado de venta_items. Nulo en los pedidos
-- sin venta: ahí el precio sigue tomándose del catálogo actual.
alter table pedido_items
  add column if not exists precio_unitario numeric(12, 2) check (precio_unitario >= 0);


-- ------------------------------------------------------------
-- 2) crear_pedido: venta opcional
-- ------------------------------------------------------------
-- Cambia la firma (parámetro nuevo al final, con valor por defecto),
-- así que primero se borra la versión de 0006: si no, quedarían las
-- dos sobrecargas conviviendo.
drop function if exists public.crear_pedido(text, text, text, text, text, text, text, jsonb);

create or replace function public.crear_pedido(
  p_cliente_nombre text,
  p_cliente_contacto text,
  p_direccion_calle text,
  p_direccion_comuna text,
  p_direccion_ciudad text,
  p_direccion_region text,
  p_direccion_referencia text,
  p_items jsonb,
  p_venta_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol rol_usuario;
  v_pedido_id uuid;
  v_vendedor_venta uuid;
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

  if p_direccion_calle is null or btrim(p_direccion_calle) = ''
    or p_direccion_comuna is null or btrim(p_direccion_comuna) = ''
    or p_direccion_ciudad is null or btrim(p_direccion_ciudad) = ''
    or p_direccion_region is null or btrim(p_direccion_region) = '' then
    raise exception 'La dirección de despacho necesita calle, comuna, ciudad y región.'
      using errcode = '22023';
  end if;

  if p_venta_id is not null then
    -- `for update` bloquea la venta hasta el fin de la transacción: dos
    -- personas que intenten crear pedido de la misma venta a la vez se
    -- ponen en fila, y la segunda ve que ya existe.
    select vendedor_id into v_vendedor_venta
    from ventas
    where id = p_venta_id
    for update;

    if not found then
      raise exception 'La venta indicada no existe.'
        using errcode = '23503';
    end if;

    -- La función corre con permisos propios (se salta RLS), así que
    -- esta regla hay que aplicarla acá: un vendedor solo puede usar
    -- sus propias ventas; el administrador, cualquiera.
    if v_rol = 'vendedor' and v_vendedor_venta <> auth.uid() then
      raise exception 'Solo puedes crear un pedido a partir de tus propias ventas.'
        using errcode = '42501';
    end if;

    if exists (select 1 from pedidos where venta_id = p_venta_id) then
      raise exception 'Esta venta ya tiene un pedido asociado.'
        using errcode = 'P0001';
    end if;

    if not exists (select 1 from venta_items where venta_id = p_venta_id) then
      raise exception 'La venta no tiene productos.'
        using errcode = 'P0001';
    end if;
  elsif p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.'
      using errcode = '22023';
  end if;

  insert into pedidos (
    responsable_id, cliente_nombre, cliente_contacto, estado,
    direccion_calle, direccion_comuna, direccion_ciudad, direccion_region, direccion_referencia,
    venta_id
  )
  values (
    auth.uid(), btrim(p_cliente_nombre), nullif(btrim(p_cliente_contacto), ''), 'pendiente',
    btrim(p_direccion_calle), btrim(p_direccion_comuna), btrim(p_direccion_ciudad), btrim(p_direccion_region),
    nullif(btrim(p_direccion_referencia), ''),
    p_venta_id
  )
  returning id into v_pedido_id;

  if p_venta_id is not null then
    -- Con venta, los productos se copian de la venta en el servidor y
    -- se ignora p_items: así el pedido no puede diferir de lo vendido.
    -- No se valida stock: ya se descontó al registrar la venta (y
    -- validarlo acá rechazaría pedidos de la última unidad).
    insert into pedido_items (pedido_id, variante_id, cantidad, precio_unitario)
    select v_pedido_id, variante_id, cantidad, precio_unitario
    from venta_items
    where venta_id = p_venta_id;
  else
    -- Sin venta: igual que en 0006 (valida stock combinado, no descuenta).
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
  end if;

  return v_pedido_id;
end;
$$;

revoke execute on function public.crear_pedido(text, text, text, text, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.crear_pedido(text, text, text, text, text, text, text, jsonb, uuid) to authenticated;


-- ------------------------------------------------------------
-- 3) avanzar_estado_pedido: no descontar stock si el pedido viene
--    de una venta
-- ------------------------------------------------------------
-- Misma firma que en 0005: se reemplaza en el lugar. Lo único que
-- cambia es que la transición a "despachado" solo mueve stock cuando
-- el pedido NO tiene venta_id.
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
      fecha_actualizacion = now()
  where id = p_pedido_id;

  return v_estado_siguiente;
end;
$$;

revoke execute on function public.avanzar_estado_pedido(uuid, ubicacion_stock) from public, anon;
grant execute on function public.avanzar_estado_pedido(uuid, ubicacion_stock) to authenticated;
