-- ============================================================
-- "Preparado" de Shopify -> LISTO / "Fabricado" en la app
-- ============================================================
-- Depende de 0001 a 0014.
--
-- En la tienda marcan el pedido como "Preparado" en Shopify cuando el mueble
-- está listo. Eso equivale a LISTO / estado "fabricado" en la app (no a
-- entregado). Esta migración prepara la base de datos para que la
-- sincronización lo refleje, con estas reglas:
--
--   * Solo SUBE: "por fabricar" pasa a "fabricado". Nunca baja, y nunca toca
--     "en despacho", "entregado", órdenes canceladas ni unidades que ya
--     estén LISTO. Esa regla vive en marcar_fabricadas_shopify(), no en la
--     Edge Function: aunque la función se equivocara, la base la hace
--     cumplir.
--   * Por unidad: si una línea tiene 3 sofás y Shopify tiene 2 preparados, se
--     suben 2 unidades (la sincronización las elige).
--   * Solo cuando Shopify CAMBIA: la orden recuerda lo último que dijo
--     Shopify (shopify_preparado). Si alguien desmarca LISTO en la app, la
--     sincronización no lo vuelve a marcar mientras Shopify siga igual.
--   * Si en Shopify lo desmarcan, la app NO baja nada: solo registra el cambio
--     y avisa.
--   * Las etapas B, I, A y C no se tocan.
--   * Todo parte APAGADO: sync_shopify.aplicar_preparado = false. Con la
--     bandera apagada la sincronización no cambia ningún estado ni guarda lo
--     que dice Shopify. Se enciende a mano, después de revisar el dry-run:
--         update sync_shopify set aplicar_preparado = true;
--
-- Columnas nuevas de ordenes_fabricacion:
--   shopify_preparado  lo último que dijo Shopify de esta unidad.
--   listo_origen       quién marcó LISTO: 'app' o 'shopify' (NULL si no está
--                      LISTO). Sirve para mostrarlo y para poder deshacerlo.
--
-- Para DESHACER lo que subió Shopify (solo las unidades que siguen en
-- "fabricado"; no toca las que ya avanzaron a despacho o entregado):
--     update ordenes_fabricacion
--     set listo = false, listo_en = null, estado = 'por_fabricar',
--         listo_origen = null, actualizado_en = now()
--     where listo_origen = 'shopify' and estado = 'fabricado';
--
-- Es compatible hacia atrás: la función sincronizar-shopify anterior sigue
-- funcionando con esta migración aplicada. Aplícala ANTES de publicar la
-- versión nueva de la pantalla y de desplegar la función nueva.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Columnas nuevas
-- ------------------------------------------------------------
alter table ordenes_fabricacion
  add column shopify_preparado boolean not null default false,
  add column listo_origen text
    constraint ordenes_fabricacion_listo_origen_valido check (listo_origen in ('app', 'shopify'));

-- Todo lo que hoy está LISTO lo marcó alguien en la app.
update ordenes_fabricacion set listo_origen = 'app' where listo;

-- LISTO y su origen van siempre juntos.
alter table ordenes_fabricacion
  add constraint ordenes_fabricacion_listo_origen_coherente check (listo = (listo_origen is not null));

alter table sync_shopify
  add column aplicar_preparado boolean not null default false;


-- ------------------------------------------------------------
-- 2) marcar_etapa: ahora también registra quién marcó LISTO
-- ------------------------------------------------------------
-- Misma función de la 0012; lo único nuevo es listo_origen.
create or replace function public.marcar_etapa(
  p_orden_id uuid,
  p_etapa text,
  p_valor boolean
)
returns ordenes_fabricacion
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden ordenes_fabricacion;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar órdenes de fabricación.'
      using errcode = '42501';
  end if;

  if p_etapa is null or p_etapa not in ('b', 'i', 'a', 'c', 'listo') then
    raise exception 'Etapa inválida: %. Usa b, i, a, c o listo.', p_etapa
      using errcode = '22023';
  end if;

  if p_valor is null then
    raise exception 'Indica si la etapa queda marcada o no.'
      using errcode = '22023';
  end if;

  select * into v_orden
  from ordenes_fabricacion
  where id = p_orden_id
  for update;

  if not found then
    raise exception 'La orden indicada no existe.'
      using errcode = '23503';
  end if;

  if v_orden.cancelado_en is not null then
    raise exception 'La orden % fue cancelada en Shopify.', v_orden.numero
      using errcode = 'P0001';
  end if;

  if v_orden.estado in ('en_despacho', 'entregado') then
    raise exception 'La orden % ya está en despacho o entregada: no se pueden cambiar sus etapas.', v_orden.numero
      using errcode = 'P0001';
  end if;

  if p_etapa = 'listo' then
    update ordenes_fabricacion
    set listo = p_valor,
        listo_en = case when p_valor then now() else null end,
        -- Quien marca o desmarca LISTO desde la app queda como origen "app".
        listo_origen = case when p_valor then 'app' else null end,
        estado = case when p_valor then 'fabricado'::estado_orden_fabricacion
                      else 'por_fabricar'::estado_orden_fabricacion end,
        actualizado_en = now()
    where id = p_orden_id
    returning * into v_orden;
  else
    update ordenes_fabricacion
    set etapa_b = case when p_etapa = 'b' then p_valor else etapa_b end,
        etapa_i = case when p_etapa = 'i' then p_valor else etapa_i end,
        etapa_a = case when p_etapa = 'a' then p_valor else etapa_a end,
        etapa_c = case when p_etapa = 'c' then p_valor else etapa_c end,
        actualizado_en = now()
    where id = p_orden_id
    returning * into v_orden;
  end if;

  return v_orden;
end;
$$;

revoke execute on function public.marcar_etapa(uuid, text, boolean) from public, anon;
grant execute on function public.marcar_etapa(uuid, text, boolean) to authenticated;


-- ------------------------------------------------------------
-- 3) reservar_sync_shopify: ahora también devuelve la bandera
-- ------------------------------------------------------------
-- Cambia el tipo de lo que devuelve, así que hay que borrarla y crearla de
-- nuevo (create or replace no lo permite). La versión anterior de la Edge
-- Function sigue funcionando: solo lee importar_desde y
-- ultima_sincronizacion.
drop function public.reservar_sync_shopify(integer);

create function public.reservar_sync_shopify(p_minutos_maximo integer default 10)
returns table (importar_desde date, ultima_sincronizacion timestamptz, aplicar_preparado boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  update sync_shopify s
  set en_curso_desde = now(),
      ultimo_intento = now()
  where s.id
    and (s.en_curso_desde is null
         or s.en_curso_desde < now() - make_interval(mins => p_minutos_maximo))
  returning s.importar_desde, s.ultima_sincronizacion, s.aplicar_preparado;
end;
$$;

revoke execute on function public.reservar_sync_shopify(integer) from public, anon, authenticated;
grant execute on function public.reservar_sync_shopify(integer) to service_role;


-- ------------------------------------------------------------
-- 4) marcar_fabricadas_shopify: la única forma en que Shopify sube un estado
-- ------------------------------------------------------------
-- Pasa a "fabricado" (LISTO, origen 'shopify') las órdenes indicadas, pero SOLO
-- las que siguen "por fabricar", sin LISTO y sin cancelar. Todo lo demás se
-- ignora en silencio. Devuelve cuántas subió. p_cuando es el momento en que
-- Shopify las marcó preparadas (si no se informa, ahora).
create or replace function public.marcar_fabricadas_shopify(p_ids uuid[], p_cuando timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subidas integer;
begin
  update ordenes_fabricacion
  set listo = true,
      listo_en = coalesce(p_cuando, now()),
      listo_origen = 'shopify',
      estado = 'fabricado',
      actualizado_en = now()
  where id = any(p_ids)
    and estado = 'por_fabricar'
    and not listo
    and cancelado_en is null;

  get diagnostics v_subidas = row_count;
  return v_subidas;
end;
$$;

revoke execute on function public.marcar_fabricadas_shopify(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.marcar_fabricadas_shopify(uuid[], timestamptz) to service_role;
