-- ============================================================
-- Formulario de pedido: teléfono validado y ciudad opcional
-- ============================================================
-- Depende de 0001 a 0008.
--
-- Cambios:
--   1) direccion_ciudad deja de ser obligatoria. El formulario ya no la
--      pide (región y comuna salen de listas), pero la columna se CONSERVA:
--      los pedidos existentes mantienen su ciudad y no se pierde ningún dato.
--   2) crear_pedido valida el contacto: si viene, debe ser un teléfono
--      móvil chileno de 9 dígitos que parta con 9. Sigue siendo opcional.
--      Esta validación también aplica a los pedidos basados en una venta
--      (va antes de la bifurcación venta / pedido manual).
--   3) crear_pedido deja de exigir la ciudad. Se mantiene p_direccion_ciudad
--      como parámetro OPCIONAL: así el frontend anterior (que todavía la
--      envía) y el nuevo (que no) funcionan con la misma función, y da
--      igual en qué orden apliques esta migración y publiques el frontend.
--
-- avanzar_estado_pedido no usa columnas de dirección: no se toca.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Ciudad opcional (los datos existentes no se tocan)
-- ------------------------------------------------------------
alter table pedidos alter column direccion_ciudad drop not null;


-- ------------------------------------------------------------
-- 2) crear_pedido: nueva firma
-- ------------------------------------------------------------
-- Cambia la lista de parámetros, así que primero se borra la versión
-- de 0008: si no, quedarían las dos sobrecargas conviviendo.
-- Los parámetros con valor por defecto van al final; PostgREST los
-- resuelve por nombre, así que el orden no afecta a quien llama.
drop function if exists public.crear_pedido(text, text, text, text, text, text, text, jsonb, uuid);

create or replace function public.crear_pedido(
  p_cliente_nombre text,
  p_cliente_contacto text,
  p_direccion_calle text,
  p_direccion_comuna text,
  p_direccion_region text,
  p_direccion_referencia text,
  p_items jsonb,
  p_venta_id uuid default null,
  p_direccion_ciudad text default null
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
  v_contacto text;
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

  -- Teléfono: opcional, pero si viene tiene que ser un móvil chileno
  -- (9 dígitos, parte con 9). La validación del navegador se puede
  -- saltar; esta no.
  v_contacto := nullif(btrim(coalesce(p_cliente_contacto, '')), '');
  if v_contacto is not null and v_contacto !~ '^9[0-9]{8}$' then
    raise exception 'El teléfono debe tener 9 dígitos y partir con 9 (ej: 912345678).'
      using errcode = '22023';
  end if;

  if p_direccion_calle is null or btrim(p_direccion_calle) = ''
    or p_direccion_comuna is null or btrim(p_direccion_comuna) = ''
    or p_direccion_region is null or btrim(p_direccion_region) = '' then
    raise exception 'La dirección de despacho necesita calle, región y comuna.'
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
    auth.uid(), btrim(p_cliente_nombre), v_contacto, 'pendiente',
    btrim(p_direccion_calle), btrim(p_direccion_comuna), nullif(btrim(coalesce(p_direccion_ciudad, '')), ''),
    btrim(p_direccion_region), nullif(btrim(coalesce(p_direccion_referencia, '')), ''),
    p_venta_id
  )
  returning id into v_pedido_id;

  if p_venta_id is not null then
    -- Con venta, los productos se copian de la venta en el servidor y
    -- se ignora p_items: así el pedido no puede diferir de lo vendido.
    -- No se valida stock: ya se descontó al registrar la venta.
    insert into pedido_items (pedido_id, variante_id, cantidad, precio_unitario)
    select v_pedido_id, variante_id, cantidad, precio_unitario
    from venta_items
    where venta_id = p_venta_id;
  else
    -- Sin venta: valida stock combinado (bodega + showroom), no descuenta.
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

revoke execute on function public.crear_pedido(text, text, text, text, text, text, jsonb, uuid, text) from public, anon;
grant execute on function public.crear_pedido(text, text, text, text, text, text, jsonb, uuid, text) to authenticated;
