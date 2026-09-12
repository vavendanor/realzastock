-- ============================================================
-- RPC: registrar una venta de forma atómica
-- ============================================================
-- Depende de 0001, 0002 y 0003.
--
-- Problema que resuelve: registrar una venta son tres escrituras
-- (cabecera en `ventas`, líneas en `venta_items`, descuento en
-- `inventario`). Hechas por separado desde el navegador, un fallo
-- a mitad de camino deja datos inconsistentes: una venta sin
-- ítems, o ítems sin stock descontado. Una función plpgsql corre
-- entera dentro de una sola transacción: o se aplica todo, o no
-- se aplica nada.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- registrar_venta(canal, ubicacion, items)
-- ------------------------------------------------------------
-- `p_items` es un arreglo JSON con la forma:
--   [{"variante_id": "uuid", "cantidad": 2}, ...]
-- Se admite más de una línea para que la misma función sirva a una
-- venta con varios productos sin tener que cambiarla después.
--
-- Devuelve el id de la venta creada.
--
-- SOBRE security definer: la función se salta RLS a propósito.
-- Un `vendedor` NO tiene permiso para hacer UPDATE sobre
-- `inventario` (política de 0002), y así debe seguir siendo: no
-- queremos que pueda editar stock a mano. Pero sí necesita
-- descontarlo al vender. Esta función es la única vía autorizada
-- para hacerlo, y por eso valida el rol explícitamente ella misma
-- en vez de delegarlo en RLS. `set search_path` evita que alguien
-- redirija los nombres de tabla a objetos propios.
create or replace function public.registrar_venta(
  p_canal canal_venta,
  p_ubicacion ubicacion_stock,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol rol_usuario;
  v_venta_id uuid;
  v_item jsonb;
  v_variante_id uuid;
  v_cantidad integer;
  v_precio numeric(12, 2);
  v_sku text;
  v_disponible integer;
begin
  -- 1) Autorización explícita (reemplaza a RLS, que acá está anulado).
  v_rol := rol_actual();

  if v_rol is null then
    raise exception 'Debes iniciar sesión para registrar una venta.'
      using errcode = '28000';
  end if;

  if v_rol not in ('administrador', 'vendedor') then
    raise exception 'El rol % no puede registrar ventas.', v_rol
      using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta debe incluir al menos un producto.'
      using errcode = '22023';
  end if;

  -- 2) Cabecera. El vendedor es siempre quien llama: no se acepta
  --    como parámetro para que nadie registre ventas a nombre de otro.
  insert into ventas (vendedor_id, canal)
  values (auth.uid(), p_canal)
  returning id into v_venta_id;

  -- 3) Una línea de detalle y un descuento de stock por cada ítem.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_variante_id := (v_item->>'variante_id')::uuid;
    v_cantidad := (v_item->>'cantidad')::integer;

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'La cantidad debe ser mayor que cero.'
        using errcode = '22023';
    end if;

    -- El precio se toma del catálogo, nunca del cliente: si viniera
    -- en el JSON, se podría registrar una venta al precio que se
    -- quisiera.
    select precio, sku into v_precio, v_sku
    from variantes
    where id = v_variante_id;

    if not found then
      raise exception 'La variante indicada no existe.'
        using errcode = '23503';
    end if;

    -- `for update` bloquea la fila de stock hasta el fin de la
    -- transacción. Sin esto, dos ventas simultáneas de la última
    -- unidad podrían leer ambas "queda 1" y dejar el stock en -1.
    select cantidad into v_disponible
    from inventario
    where variante_id = v_variante_id and ubicacion = p_ubicacion
    for update;

    -- Sin fila de inventario para esa ubicación, el disponible es 0.
    -- (select ... into deja la variable en NULL, y NULL < n no es
    -- verdadero: hay que fijarlo a mano o la validación no dispara.)
    if not found then
      v_disponible := 0;
    end if;

    if v_disponible < v_cantidad then
      raise exception 'Stock insuficiente para % en %: hay % y se pidieron %.',
        v_sku, p_ubicacion, v_disponible, v_cantidad
        using errcode = 'P0001';
    end if;

    insert into venta_items (venta_id, variante_id, cantidad, precio_unitario)
    values (v_venta_id, v_variante_id, v_cantidad, v_precio);

    update inventario
    set cantidad = cantidad - v_cantidad,
        actualizado_en = now()
    where variante_id = v_variante_id and ubicacion = p_ubicacion;
  end loop;

  return v_venta_id;
end;
$$;

-- Solo usuarios autenticados. Un visitante anónimo igual sería
-- rechazado por la validación de rol, pero mejor no exponerla.
revoke all on function public.registrar_venta(canal_venta, ubicacion_stock, jsonb) from anon;
grant execute on function public.registrar_venta(canal_venta, ubicacion_stock, jsonb) to authenticated;
