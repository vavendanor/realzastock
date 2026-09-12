-- ============================================================
-- Dirección de despacho estructurada para "pedidos"
-- ============================================================
-- Depende de 0001 a 0005.
--
-- Contexto: la tabla `pedidos` solo tenía cliente_nombre y
-- cliente_contacto — nada que sirviera para despachar a regiones
-- de forma confiable. Se agregan 5 columnas: 4 obligatorias
-- (calle, comuna, ciudad, región) y una opcional (referencia).
--
-- Como `crear_pedido` (migración 0005) es la única vía para crear
-- un pedido, hay que reemplazarla con una firma que reciba la
-- dirección. Postgres trata distinto número/tipo de parámetros
-- como una función distinta (sobrecarga), así que primero se borra
-- la versión vieja explícitamente — si no, quedarían las dos
-- conviviendo y el cliente podría llamar a la que ya no debería
-- usarse.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Columnas nuevas
-- ------------------------------------------------------------
alter table pedidos
  add column if not exists direccion_calle text,
  add column if not exists direccion_comuna text,
  add column if not exists direccion_ciudad text,
  add column if not exists direccion_region text,
  add column if not exists direccion_referencia text;

-- Si ya existen pedidos de pruebas anteriores (antes de este cambio),
-- no tienen estos datos y el NOT NULL de más abajo fallaría. Se
-- rellenan con un valor evidentemente provisorio -- para que quien
-- administre la vea y sepa que hay que completarla a mano -- en vez
-- de inventar una dirección real que no es.
update pedidos
set direccion_calle = coalesce(direccion_calle, '(pendiente de completar)'),
    direccion_comuna = coalesce(direccion_comuna, '(pendiente)'),
    direccion_ciudad = coalesce(direccion_ciudad, '(pendiente)'),
    direccion_region = coalesce(direccion_region, '(pendiente)')
where direccion_calle is null;

alter table pedidos
  alter column direccion_calle set not null,
  alter column direccion_comuna set not null,
  alter column direccion_ciudad set not null,
  alter column direccion_region set not null;
-- direccion_referencia se deja nullable a propósito: es opcional.


-- ------------------------------------------------------------
-- 2) crear_pedido: nueva firma con dirección
-- ------------------------------------------------------------
drop function if exists public.crear_pedido(text, text, jsonb);

create or replace function public.crear_pedido(
  p_cliente_nombre text,
  p_cliente_contacto text,
  p_direccion_calle text,
  p_direccion_comuna text,
  p_direccion_ciudad text,
  p_direccion_region text,
  p_direccion_referencia text,
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

  if p_direccion_calle is null or btrim(p_direccion_calle) = ''
    or p_direccion_comuna is null or btrim(p_direccion_comuna) = ''
    or p_direccion_ciudad is null or btrim(p_direccion_ciudad) = ''
    or p_direccion_region is null or btrim(p_direccion_region) = '' then
    raise exception 'La dirección de despacho necesita calle, comuna, ciudad y región.'
      using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir al menos un producto.'
      using errcode = '22023';
  end if;

  insert into pedidos (
    responsable_id, cliente_nombre, cliente_contacto, estado,
    direccion_calle, direccion_comuna, direccion_ciudad, direccion_region, direccion_referencia
  )
  values (
    auth.uid(), btrim(p_cliente_nombre), nullif(btrim(p_cliente_contacto), ''), 'pendiente',
    btrim(p_direccion_calle), btrim(p_direccion_comuna), btrim(p_direccion_ciudad), btrim(p_direccion_region),
    nullif(btrim(p_direccion_referencia), '')
  )
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

revoke all on function public.crear_pedido(text, text, text, text, text, text, text, jsonb) from anon;
grant execute on function public.crear_pedido(text, text, text, text, text, text, text, jsonb) to authenticated;
