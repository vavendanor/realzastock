-- ============================================================
-- Hojas de fabricación y guardado por lotes de las casillas
-- ============================================================
-- Depende de 0001 a 0016. Requiere Postgres 15 o superior (Supabase lo usa):
-- la vista usa security_invoker.
--
-- Una "hoja de fabricación" es una lista con nombre de PEDIDOS que el taller
-- fabrica junto. La hoja guarda solo QUÉ pedidos incluye: los datos de cada
-- pieza (modelo, tela, casillas, estado...) se leen siempre en vivo de
-- ordenes_fabricacion, a través de la vista hoja_fabricacion_piezas.
--
--   * Un pedido puede estar en varias hojas (pero una sola vez en cada una).
--   * Una hoja incluye el pedido COMPLETO, con todas sus piezas.
--   * El máximo es de 300 pedidos por hoja.
--
-- Esta migración trae también guardar_cambios_etapas(): aplica de una vez, en
-- una sola transacción, un lote de cambios de casillas (B, I, A, C y LISTO).
-- Es la base del "Guardar" con doble verificación de la app:
--   1) La app confirma con la persona el resumen de los cambios.
--   2) La función compara cada cambio con el valor que la persona creía actual
--      ("esperado"). Si otra persona lo cambió mientras tanto, no aplica NADA y
--      devuelve la lista de choques (en el DETAIL del error, como JSON).
--   Las reglas por orden son las mismas de marcar_etapa(): no toca canceladas,
--   en despacho ni entregadas, y LISTO mueve el estado entre "por fabricar" y
--   "fabricado". marcar_etapa() sigue existiendo, sin cambios.
--
-- Permisos: administrador y bodega (la misma regla que el resto de producción,
-- tiene_acceso_produccion()). La lectura va por políticas de RLS; la
-- escritura, SOLO por estas funciones: no hay políticas de insert, update ni
-- delete.
--
-- Es compatible hacia atrás: no cambia ninguna tabla, función ni consulta
-- existente. La app y la Edge Function actuales siguen funcionando igual.
--
-- OJO con el orden: la vista hoja_fabricacion_piezas usa la columna plazo_desde
-- (de la 0016). Para deshacer la 0016 hay que deshacer ANTES esta migración.
--
-- Para DESHACER esta migración (borra las hojas guardadas; no toca ninguna
-- orden de fabricación):
--     drop function public.guardar_cambios_etapas(jsonb);
--     drop function public.eliminar_hoja_fabricacion(uuid);
--     drop function public.quitar_pedido_de_hoja(uuid, text);
--     drop function public.agregar_pedidos_a_hoja(uuid, text[]);
--     drop function public.renombrar_hoja_fabricacion(uuid, text);
--     drop function public.crear_hoja_fabricacion(text, text[]);
--     drop function public._resolver_pedidos_hoja(text[]);
--     drop view public.hoja_fabricacion_piezas;
--     drop table public.hoja_fabricacion_pedidos;
--     drop table public.hojas_fabricacion;
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'Esta migración necesita Postgres 15 o superior (vistas con security_invoker).';
  end if;
end
$$;


-- ------------------------------------------------------------
-- 1) Tablas
-- ------------------------------------------------------------
create table hojas_fabricacion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null
    constraint hojas_fabricacion_nombre_valido check (nombre = btrim(nombre) and char_length(nombre) between 1 and 80),
  creada_en timestamptz not null default now(),
  -- Si se borra el usuario, la hoja se conserva sin autor.
  creada_por uuid references usuarios(id) on delete set null,
  actualizada_en timestamptz not null default now()
);

create table hoja_fabricacion_pedidos (
  hoja_id uuid not null references hojas_fabricacion(id) on delete cascade,
  -- shopify_order_id identifica al pedido de forma estable; pedido_numero es el
  -- número que se ve ("1280") y con el que se agregan a mano. Cada pedido
  -- aparece una sola vez por hoja, por cualquiera de los dos.
  shopify_order_id text not null,
  pedido_numero text not null,
  agregado_en timestamptz not null default now(),
  agregado_por uuid references usuarios(id) on delete set null,
  primary key (hoja_id, shopify_order_id),
  constraint hoja_fabricacion_pedidos_numero_unico unique (hoja_id, pedido_numero)
);

-- Para saber en qué hojas está un pedido.
create index hoja_fabricacion_pedidos_pedido_idx on hoja_fabricacion_pedidos (shopify_order_id);


-- ------------------------------------------------------------
-- 2) RLS: lectura para quienes trabajan con producción; escritura solo por funciones
-- ------------------------------------------------------------
alter table hojas_fabricacion enable row level security;
alter table hoja_fabricacion_pedidos enable row level security;

create policy hojas_fabricacion_select on hojas_fabricacion
  for select to authenticated
  using (tiene_acceso_produccion());

create policy hoja_fabricacion_pedidos_select on hoja_fabricacion_pedidos
  for select to authenticated
  using (tiene_acceso_produccion());

revoke all on hojas_fabricacion, hoja_fabricacion_pedidos from anon;
revoke insert, update, delete, truncate on hojas_fabricacion, hoja_fabricacion_pedidos from authenticated;


-- ------------------------------------------------------------
-- 3) Vista: las piezas de cada hoja, en vivo
-- ------------------------------------------------------------
-- Una fila por pieza (orden de fabricación) de cada pedido de la hoja, con los
-- datos de HOY. security_invoker: se aplican las políticas de RLS de quien
-- consulta, no las del dueño de la vista, así que un usuario sin acceso a
-- producción no ve nada.
--
-- Incluye las canceladas y los adicionales (la pantalla decide qué mostrar y
-- avisa de los pedidos cancelados). es_pieza_fabricable marca lo que cuenta como
-- pieza en las listas: los muebles y los cojines; no las patas extra ni los
-- ajustes de medida. Las columnas se listan una a una (no o.*) para que un
-- cambio futuro en ordenes_fabricacion no quede bloqueado por esta vista.
create view hoja_fabricacion_piezas
with (security_invoker = true) as
select
  hp.hoja_id,
  o.id,
  o.numero,
  o.pedido_numero,
  o.shopify_order_id,
  o.shopify_line_item_id,
  o.unidad,
  o.tipo,
  o.modelo,
  o.orientacion,
  o.cm,
  o.color,
  o.tela,
  o.region,
  o.comuna,
  o.comuna_revisar,
  o.patas,
  o.fecha_pedido,
  o.pedido_creado_en,
  o.plazo_desde,
  o.titulo_shopify,
  o.es_adicional,
  (not o.es_adicional or o.tipo = 'COJÍN') as es_pieza_fabricable,
  o.etapa_b,
  o.etapa_i,
  o.etapa_a,
  o.etapa_c,
  o.listo,
  o.listo_en,
  o.listo_origen,
  o.estado,
  o.cancelado_en,
  o.notas_produccion,
  o.origen,
  o.origen_shopify,
  o.despachado_en,
  o.shopify_preparado,
  o.actualizado_en
from hoja_fabricacion_pedidos hp
join ordenes_fabricacion o on o.shopify_order_id = hp.shopify_order_id;

revoke all on hoja_fabricacion_piezas from anon;
revoke insert, update, delete, truncate on hoja_fabricacion_piezas from authenticated;
grant select on hoja_fabricacion_piezas to authenticated;


-- ------------------------------------------------------------
-- 4) _resolver_pedidos_hoja (interna): de "1280" al pedido real
-- ------------------------------------------------------------
-- Recibe números de pedido y devuelve, para cada uno, su shopify_order_id. Falla,
-- sin devolver nada, si algún número no tiene órdenes activas (no existe o está
-- todo cancelado) o si no es un número válido. Nadie puede llamarla desde la app:
-- la usan las funciones de abajo.
create or replace function public._resolver_pedidos_hoja(p_numeros text[])
returns table (numero_pedido text, order_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limpios text[];
  v_faltan text[];
  v_ambiguos text[];
begin
  select coalesce(array_agg(distinct btrim(n)), '{}') into v_limpios
  from unnest(coalesce(p_numeros, '{}')) as n
  where btrim(n) <> '';

  if exists (select 1 from unnest(v_limpios) as n where n !~ '^[0-9A-Za-z]{1,20}$') then
    raise exception 'Hay un número de pedido que no es válido.'
      using errcode = '22023';
  end if;

  select array_agg(n order by n) into v_faltan
  from unnest(v_limpios) as n
  where not exists (
    select 1 from ordenes_fabricacion o where o.pedido_numero = n and o.cancelado_en is null
  );
  if v_faltan is not null then
    raise exception 'No hay órdenes activas de los pedidos: %.', array_to_string(v_faltan, ', ')
      using errcode = '23503';
  end if;

  select array_agg(x.pn order by x.pn) into v_ambiguos
  from (
    select o.pedido_numero as pn
    from ordenes_fabricacion o
    where o.pedido_numero = any(v_limpios) and o.cancelado_en is null
    group by o.pedido_numero
    having count(distinct o.shopify_order_id) > 1
  ) x;
  if v_ambiguos is not null then
    raise exception 'El número de pedido corresponde a más de un pedido de Shopify: %.', array_to_string(v_ambiguos, ', ')
      using errcode = 'P0001';
  end if;

  return query
  select o.pedido_numero, min(o.shopify_order_id)
  from ordenes_fabricacion o
  where o.pedido_numero = any(v_limpios) and o.cancelado_en is null
  group by o.pedido_numero
  order by o.pedido_numero;
end;
$$;

revoke execute on function public._resolver_pedidos_hoja(text[]) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 5) crear_hoja_fabricacion
-- ------------------------------------------------------------
-- Crea la hoja con el nombre y los pedidos indicados (por número de pedido; los
-- repetidos se cuentan una vez). Todo o nada: si un número no existe, no se crea
-- nada. Devuelve el id de la hoja.
create or replace function public.crear_hoja_fabricacion(p_nombre text, p_pedidos text[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c_maximo constant integer := 300;
  v_nombre text := btrim(p_nombre);
  v_cantidad integer;
  v_hoja uuid;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar hojas de fabricación.'
      using errcode = '42501';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 1 and 80 then
    raise exception 'El nombre de la hoja debe tener entre 1 y 80 caracteres.'
      using errcode = '22023';
  end if;

  select count(*) into v_cantidad from public._resolver_pedidos_hoja(p_pedidos);
  if v_cantidad > c_maximo then
    raise exception 'Una hoja admite como máximo % pedidos.', c_maximo
      using errcode = '22023';
  end if;

  insert into hojas_fabricacion (nombre, creada_por)
  values (v_nombre, auth.uid())
  returning id into v_hoja;

  insert into hoja_fabricacion_pedidos (hoja_id, shopify_order_id, pedido_numero, agregado_por)
  select v_hoja, r.order_id, r.numero_pedido, auth.uid()
  from public._resolver_pedidos_hoja(p_pedidos) r;

  return v_hoja;
end;
$$;


-- ------------------------------------------------------------
-- 6) renombrar_hoja_fabricacion
-- ------------------------------------------------------------
create or replace function public.renombrar_hoja_fabricacion(p_hoja_id uuid, p_nombre text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text := btrim(p_nombre);
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar hojas de fabricación.'
      using errcode = '42501';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 1 and 80 then
    raise exception 'El nombre de la hoja debe tener entre 1 y 80 caracteres.'
      using errcode = '22023';
  end if;

  update hojas_fabricacion set nombre = v_nombre, actualizada_en = now() where id = p_hoja_id;
  if not found then
    raise exception 'La hoja indicada no existe.'
      using errcode = '23503';
  end if;
end;
$$;


-- ------------------------------------------------------------
-- 7) agregar_pedidos_a_hoja
-- ------------------------------------------------------------
-- Agrega pedidos (por número) a una hoja. Los que ya estaban se ignoran.
-- Devuelve cuántos agregó de verdad. Todo o nada: si un número no existe, no
-- agrega ninguno. Respeta el máximo de 300 pedidos por hoja.
create or replace function public.agregar_pedidos_a_hoja(p_hoja_id uuid, p_pedidos text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_maximo constant integer := 300;
  v_existentes integer;
  v_nuevos integer;
  v_agregados integer;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar hojas de fabricación.'
      using errcode = '42501';
  end if;

  -- Bloquea la hoja: dos personas agregando a la vez no pueden pasar del máximo.
  perform 1 from hojas_fabricacion where id = p_hoja_id for update;
  if not found then
    raise exception 'La hoja indicada no existe.'
      using errcode = '23503';
  end if;

  select count(*) into v_existentes from hoja_fabricacion_pedidos where hoja_id = p_hoja_id;
  select count(*) into v_nuevos
  from public._resolver_pedidos_hoja(p_pedidos) r
  where not exists (
    select 1 from hoja_fabricacion_pedidos hp where hp.hoja_id = p_hoja_id and hp.shopify_order_id = r.order_id
  );

  if v_existentes + v_nuevos > c_maximo then
    raise exception 'Una hoja admite como máximo % pedidos (tiene % y se intentan agregar %).', c_maximo, v_existentes, v_nuevos
      using errcode = '22023';
  end if;

  insert into hoja_fabricacion_pedidos (hoja_id, shopify_order_id, pedido_numero, agregado_por)
  select p_hoja_id, r.order_id, r.numero_pedido, auth.uid()
  from public._resolver_pedidos_hoja(p_pedidos) r
  on conflict do nothing;

  get diagnostics v_agregados = row_count;
  if v_agregados > 0 then
    update hojas_fabricacion set actualizada_en = now() where id = p_hoja_id;
  end if;
  return v_agregados;
end;
$$;


-- ------------------------------------------------------------
-- 8) quitar_pedido_de_hoja y eliminar_hoja_fabricacion
-- ------------------------------------------------------------
-- Devuelven cuántas filas borraron (1 o 0): si otra persona ya lo había quitado,
-- no es un error.
create or replace function public.quitar_pedido_de_hoja(p_hoja_id uuid, p_pedido_numero text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrados integer;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar hojas de fabricación.'
      using errcode = '42501';
  end if;

  delete from hoja_fabricacion_pedidos where hoja_id = p_hoja_id and pedido_numero = btrim(p_pedido_numero);
  get diagnostics v_borrados = row_count;
  if v_borrados > 0 then
    update hojas_fabricacion set actualizada_en = now() where id = p_hoja_id;
  end if;
  return v_borrados;
end;
$$;

create or replace function public.eliminar_hoja_fabricacion(p_hoja_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrados integer;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar hojas de fabricación.'
      using errcode = '42501';
  end if;

  -- Los pedidos de la hoja se borran solos (on delete cascade). Las órdenes de
  -- fabricación no se tocan.
  delete from hojas_fabricacion where id = p_hoja_id;
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;


-- ------------------------------------------------------------
-- 9) guardar_cambios_etapas: el "Guardar" por lotes
-- ------------------------------------------------------------
-- p_cambios: lista JSON de hasta 500 cambios, cada uno
--     { "orden_id": "<uuid>", "etapa": "b"|"i"|"a"|"c"|"listo",
--       "valor": true|false,          -- cómo debe quedar la casilla
--       "esperado": true|false }      -- cómo estaba cuando la persona la vio
-- Todo o nada. Un cambio con valor = esperado no cambia nada y se ignora.
-- Si algún cambio no se puede aplicar, no se aplica ninguno y se lanza el error
-- "Hay cambios que no se pueden guardar" (errcode P0001), con la lista de
-- problemas como JSON en el DETAIL:
--     [{ "orden_id", "numero", "etapa", "motivo", "actual" }, ...]
-- motivo: 'conflicto' (alguien más la cambió), 'cancelada', 'bloqueada' (en
-- despacho o entregada) o 'no_existe'.
-- Devuelve las órdenes actualizadas (con su estado nuevo).
create or replace function public.guardar_cambios_etapas(p_cambios jsonb)
returns setof ordenes_fabricacion
language plpgsql
security definer
set search_path = public
as $$
declare
  c_maximo constant integer := 500;
  v_elemento jsonb;
  v_problemas jsonb;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar órdenes de fabricación.'
      using errcode = '42501';
  end if;

  if p_cambios is null or jsonb_typeof(p_cambios) is distinct from 'array' then
    raise exception 'Los cambios deben ser una lista.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_cambios) = 0 then
    raise exception 'No hay cambios para guardar.'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_cambios) > c_maximo then
    raise exception 'Son demasiados cambios de una vez (máximo %).', c_maximo
      using errcode = '22023';
  end if;

  -- Forma de cada cambio.
  for v_elemento in select e.value from jsonb_array_elements(p_cambios) as e loop
    if jsonb_typeof(v_elemento) is distinct from 'object'
       or jsonb_typeof(v_elemento -> 'orden_id') is distinct from 'string'
       or coalesce(v_elemento ->> 'orden_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_elemento ->> 'etapa', '') not in ('b', 'i', 'a', 'c', 'listo')
       or jsonb_typeof(v_elemento -> 'valor') is distinct from 'boolean'
       or jsonb_typeof(v_elemento -> 'esperado') is distinct from 'boolean' then
      raise exception 'Cambio inválido: %', left(v_elemento::text, 200)
        using errcode = '22023';
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(p_cambios) as e
    group by e ->> 'orden_id', e ->> 'etapa'
    having count(*) > 1
  ) then
    raise exception 'Hay dos cambios para la misma casilla de la misma orden.'
      using errcode = '22023';
  end if;

  -- Bloquea todas las órdenes del lote, siempre en el mismo orden (id): dos
  -- personas guardando a la vez no pueden bloquearse entre sí.
  perform 1
  from ordenes_fabricacion
  where id in (select (e ->> 'orden_id')::uuid from jsonb_array_elements(p_cambios) as e)
  order by id
  for update;

  -- Qué cambios no se pueden aplicar.
  select coalesce(jsonb_agg(q.p order by q.p ->> 'numero', q.p ->> 'etapa'), '[]'::jsonb) into v_problemas
  from (
    select jsonb_build_object(
             'orden_id', c.orden_id,
             'numero', o.numero,
             'etapa', c.etapa,
             'motivo', case
                         when o.id is null then 'no_existe'
                         when o.cancelado_en is not null then 'cancelada'
                         when o.estado in ('en_despacho', 'entregado') then 'bloqueada'
                         else 'conflicto'
                       end,
             'actual', case c.etapa when 'b' then o.etapa_b when 'i' then o.etapa_i when 'a' then o.etapa_a when 'c' then o.etapa_c else o.listo end
           ) as p
    from (
      select (e ->> 'orden_id')::uuid as orden_id, e ->> 'etapa' as etapa,
             (e ->> 'valor')::boolean as valor, (e ->> 'esperado')::boolean as esperado
      from jsonb_array_elements(p_cambios) as e
    ) c
    left join ordenes_fabricacion o on o.id = c.orden_id
    where c.valor <> c.esperado
      and (
        o.id is null
        or o.cancelado_en is not null
        or o.estado in ('en_despacho', 'entregado')
        or (case c.etapa when 'b' then o.etapa_b when 'i' then o.etapa_i when 'a' then o.etapa_a when 'c' then o.etapa_c else o.listo end) <> c.esperado
      )
  ) q;

  if jsonb_array_length(v_problemas) > 0 then
    raise exception 'Hay cambios que no se pueden guardar: no se aplicó ninguno.'
      using errcode = 'P0001', detail = v_problemas::text;
  end if;

  -- Aplica todo, una sola vez por orden. LISTO, igual que marcar_etapa(): al
  -- marcarlo pasa a "fabricado" (LISTO por la app); al desmarcarlo vuelve a
  -- "por fabricar".
  return query
  with cambios as (
    select (e ->> 'orden_id')::uuid as id, e ->> 'etapa' as etapa, (e ->> 'valor')::boolean as valor
    from jsonb_array_elements(p_cambios) as e
    where (e ->> 'valor')::boolean <> (e ->> 'esperado')::boolean
  ),
  por_orden as (
    select id,
           bool_or(valor) filter (where etapa = 'b') as nb,
           bool_or(valor) filter (where etapa = 'i') as ni,
           bool_or(valor) filter (where etapa = 'a') as na,
           bool_or(valor) filter (where etapa = 'c') as nc,
           bool_or(valor) filter (where etapa = 'listo') as nl
    from cambios
    group by id
  ),
  actualizadas as (
    update ordenes_fabricacion o
    set etapa_b = coalesce(p.nb, o.etapa_b),
        etapa_i = coalesce(p.ni, o.etapa_i),
        etapa_a = coalesce(p.na, o.etapa_a),
        etapa_c = coalesce(p.nc, o.etapa_c),
        listo = coalesce(p.nl, o.listo),
        listo_en = case when p.nl is true then now() when p.nl is false then null else o.listo_en end,
        listo_origen = case when p.nl is true then 'app' when p.nl is false then null else o.listo_origen end,
        estado = case when p.nl is true then 'fabricado'::estado_orden_fabricacion
                      when p.nl is false then 'por_fabricar'::estado_orden_fabricacion
                      else o.estado end,
        actualizado_en = now()
    from por_orden p
    where o.id = p.id
    returning o.*
  )
  select a.* from actualizadas a order by a.numero;
end;
$$;


-- ------------------------------------------------------------
-- 10) Permisos de ejecución
-- ------------------------------------------------------------
-- Cada función revisa por dentro que quien llama sea administrador o bodega.
revoke execute on function public.crear_hoja_fabricacion(text, text[]) from public, anon;
revoke execute on function public.renombrar_hoja_fabricacion(uuid, text) from public, anon;
revoke execute on function public.agregar_pedidos_a_hoja(uuid, text[]) from public, anon;
revoke execute on function public.quitar_pedido_de_hoja(uuid, text) from public, anon;
revoke execute on function public.eliminar_hoja_fabricacion(uuid) from public, anon;
revoke execute on function public.guardar_cambios_etapas(jsonb) from public, anon;

grant execute on function public.crear_hoja_fabricacion(text, text[]) to authenticated;
grant execute on function public.renombrar_hoja_fabricacion(uuid, text) to authenticated;
grant execute on function public.agregar_pedidos_a_hoja(uuid, text[]) to authenticated;
grant execute on function public.quitar_pedido_de_hoja(uuid, text) to authenticated;
grant execute on function public.eliminar_hoja_fabricacion(uuid) to authenticated;
grant execute on function public.guardar_cambios_etapas(jsonb) to authenticated;
