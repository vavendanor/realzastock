-- ============================================================
-- Despachos: fecha programada de entrega por mueble
-- ============================================================
-- Depende de 0001 a 0017.
--
-- Agrega lo mínimo para programar despachos:
--
--   * ordenes_fabricacion.despacho_programado (date): el día en que se planea
--     entregar ESE mueble (o en que salió, si se marcó despachado sin fecha).
--     Es por mueble: un pedido puede salir en partes, cada una en su fecha.
--
--   * programar_despacho(ids, fecha): fija la fecha de varios muebles a la vez.
--     Solo muebles FABRICADOS y no cancelados; no admite fechas anteriores a
--     hoy (hora de Chile). Todo o nada.
--   * quitar_despacho_programado(ids): quita la fecha antes de que el mueble
--     salga. Si alguno ya salió a despacho, no cambia nada y lo dice.
--   * marcar_despachado(ids): pasa varios muebles de "fabricado" a "en despacho"
--     de una vez (todo o nada), con las mismas reglas de avanzar_estado_orden
--     (0013): guarda despachado_en. Si el mueble no tenía fecha programada,
--     se le pone la de hoy, para que el día quede completo en la vista por fecha.
--     No avanza muebles que ya están "en despacho" (eso sigue siendo del
--     botón "Pasar a entregado" de cada pedido).
--
-- Un disparador mantiene la coherencia: si un mueble vuelve a "por fabricar"
-- (se desmarca LISTO) o su pedido se cancela, se borra su fecha programada.
--
-- Permisos: administrador y bodega (tiene_acceso_produccion(), como el resto de
-- producción). Vendedor y anónimo no pueden llamar a las funciones ni ven
-- órdenes (RLS). La escritura va SOLO por estas funciones.
--
-- La sincronización con Shopify no pisa estos datos: su upsert escribe solo las
-- columnas que Shopify informa, y despacho_programado no es una de ellas.
--
-- Es compatible hacia atrás: la app anterior sigue funcionando igual (no usa
-- la columna nueva).
--
-- Para DESHACER esta migración (se pierden las fechas programadas; ninguna
-- orden cambia de estado):
--     drop trigger ordenes_fabricacion_despacho_coherente on public.ordenes_fabricacion;
--     drop function public.despacho_programado_coherente();
--     drop function public.marcar_despachado(uuid[]);
--     drop function public.quitar_despacho_programado(uuid[]);
--     drop function public.programar_despacho(uuid[], date);
--     drop index public.ordenes_fabricacion_despacho_idx;
--     alter table public.ordenes_fabricacion drop column despacho_programado;
--
-- Cómo aplicarla: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) La columna y su índice
-- ------------------------------------------------------------
alter table ordenes_fabricacion add column despacho_programado date;

create index ordenes_fabricacion_despacho_idx
  on ordenes_fabricacion (despacho_programado)
  where despacho_programado is not null;


-- ------------------------------------------------------------
-- 2) Coherencia: sin fecha si el mueble no está fabricado o se canceló
-- ------------------------------------------------------------
create or replace function public.despacho_programado_coherente()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'por_fabricar' or new.cancelado_en is not null then
    new.despacho_programado := null;
  end if;
  return new;
end;
$$;

create trigger ordenes_fabricacion_despacho_coherente
  before update of estado, cancelado_en
  on ordenes_fabricacion
  for each row execute function despacho_programado_coherente();


-- ------------------------------------------------------------
-- 3) programar_despacho
-- ------------------------------------------------------------
create or replace function public.programar_despacho(p_orden_ids uuid[], p_fecha date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_maximo constant integer := 500;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_ids uuid[];
  v_existen integer;
  v_malos text;
  v_filas integer;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar despachos.'
      using errcode = '42501';
  end if;

  if p_fecha is null then
    raise exception 'Indica la fecha del despacho.'
      using errcode = '22023';
  end if;
  if p_fecha < v_hoy then
    raise exception 'La fecha del despacho no puede ser anterior a hoy (%).', to_char(v_hoy, 'DD-MM-YYYY')
      using errcode = '22023';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_orden_ids) as x where x is not null;
  if v_ids is null then
    raise exception 'Elige al menos un mueble.'
      using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > c_maximo then
    raise exception 'Se pueden programar hasta % muebles a la vez (se intentan %).', c_maximo, array_length(v_ids, 1)
      using errcode = '22023';
  end if;

  -- Bloquea los muebles (siempre en el mismo orden) y revisa todos antes de cambiar nada.
  perform 1 from ordenes_fabricacion where id = any(v_ids) order by id for update;
  select count(*) into v_existen from ordenes_fabricacion where id = any(v_ids);
  if v_existen <> array_length(v_ids, 1) then
    raise exception 'Alguno de los muebles indicados no existe.'
      using errcode = '23503';
  end if;

  select string_agg(numero, ', ' order by numero) into v_malos
  from ordenes_fabricacion
  where id = any(v_ids) and (cancelado_en is not null or estado <> 'fabricado');
  if v_malos is not null then
    raise exception 'Solo se programan muebles fabricados y no cancelados. No se pudo con: %. No se programó ninguno.', v_malos
      using errcode = 'P0001';
  end if;

  update ordenes_fabricacion
  set despacho_programado = p_fecha, actualizado_en = now()
  where id = any(v_ids);
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;


-- ------------------------------------------------------------
-- 4) quitar_despacho_programado
-- ------------------------------------------------------------
-- Devuelve cuántos muebles quedaron sin fecha. Los que ya no tenían fecha no son
-- un error (otra persona pudo quitarla antes). Los que ya salieron a despacho sí.
create or replace function public.quitar_despacho_programado(p_orden_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_existen integer;
  v_salieron text;
  v_filas integer;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar despachos.'
      using errcode = '42501';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_orden_ids) as x where x is not null;
  if v_ids is null then
    raise exception 'Elige al menos un mueble.'
      using errcode = '22023';
  end if;

  perform 1 from ordenes_fabricacion where id = any(v_ids) order by id for update;
  select count(*) into v_existen from ordenes_fabricacion where id = any(v_ids);
  if v_existen <> array_length(v_ids, 1) then
    raise exception 'Alguno de los muebles indicados no existe.'
      using errcode = '23503';
  end if;

  select string_agg(numero, ', ' order by numero) into v_salieron
  from ordenes_fabricacion
  where id = any(v_ids) and estado in ('en_despacho', 'entregado');
  if v_salieron is not null then
    raise exception 'Ya salieron a despacho y no se les puede quitar la fecha: %. No se cambió ninguno.', v_salieron
      using errcode = 'P0001';
  end if;

  update ordenes_fabricacion
  set despacho_programado = null, actualizado_en = now()
  where id = any(v_ids) and despacho_programado is not null;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;


-- ------------------------------------------------------------
-- 5) marcar_despachado
-- ------------------------------------------------------------
create or replace function public.marcar_despachado(p_orden_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_maximo constant integer := 500;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_ids uuid[];
  v_existen integer;
  v_malos text;
  v_filas integer;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar despachos.'
      using errcode = '42501';
  end if;

  select array_agg(distinct x) into v_ids from unnest(p_orden_ids) as x where x is not null;
  if v_ids is null then
    raise exception 'Elige al menos un mueble.'
      using errcode = '22023';
  end if;
  if array_length(v_ids, 1) > c_maximo then
    raise exception 'Se pueden despachar hasta % muebles a la vez (se intentan %).', c_maximo, array_length(v_ids, 1)
      using errcode = '22023';
  end if;

  perform 1 from ordenes_fabricacion where id = any(v_ids) order by id for update;
  select count(*) into v_existen from ordenes_fabricacion where id = any(v_ids);
  if v_existen <> array_length(v_ids, 1) then
    raise exception 'Alguno de los muebles indicados no existe.'
      using errcode = '23503';
  end if;

  select string_agg(numero, ', ' order by numero) into v_malos
  from ordenes_fabricacion
  where id = any(v_ids) and (cancelado_en is not null or estado <> 'fabricado');
  if v_malos is not null then
    raise exception 'Solo se despachan muebles fabricados y no cancelados. No se pudo con: %. No se despachó ninguno.', v_malos
      using errcode = 'P0001';
  end if;

  update ordenes_fabricacion
  set estado = 'en_despacho',
      despachado_en = now(),
      despacho_programado = coalesce(despacho_programado, v_hoy),
      actualizado_en = now()
  where id = any(v_ids);
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;


-- ------------------------------------------------------------
-- 6) Permisos: solo usuarios con sesión (y dentro, la función exige administrador o bodega)
-- ------------------------------------------------------------
revoke execute on function public.programar_despacho(uuid[], date) from public, anon;
revoke execute on function public.quitar_despacho_programado(uuid[]) from public, anon;
revoke execute on function public.marcar_despachado(uuid[]) from public, anon;
grant execute on function public.programar_despacho(uuid[], date) to authenticated;
grant execute on function public.quitar_despacho_programado(uuid[]) to authenticated;
grant execute on function public.marcar_despachado(uuid[]) to authenticated;
