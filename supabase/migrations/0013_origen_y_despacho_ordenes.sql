-- ============================================================
-- Origen de la orden, fecha de despacho y teléfono del cliente
-- ============================================================
-- Depende de 0001 a 0012.
--
-- Prepara las órdenes de fabricación para reemplazar por completo el flujo
-- antiguo de pedidos manuales:
--
--   1) ordenes_fabricacion.origen: de dónde vino el pedido en Shopify.
--        'tienda_en_linea'  -> lo hizo el cliente en la tienda web.
--        'manual_shopify'   -> lo creó alguien a mano en Shopify (pedido de
--                              borrador, POS, app móvil, etc.).
--      ordenes_fabricacion.origen_shopify guarda el valor CRUDO que informa
--      Shopify (sourceName: "web", "shopify_draft_order", "pos"...), para
--      poder reclasificar sin volver a pedir los datos.
--      La regla vive en la base de datos (trigger): "web" es Tienda en línea
--      y todo lo demás es Manual en Shopify. Si Shopify no informa el origen,
--      queda vacío: no se inventa.
--
--   2) ordenes_fabricacion.despachado_en: cuándo salió a despacho. Lo guarda
--      avanzar_estado_orden al pasar a "en despacho". El comprobante de
--      despacho lo imprime. Las órdenes que ya estaban en despacho o
--      entregadas antes de esta migración quedan sin ese dato (no se
--      inventa; el comprobante usa la última actualización como referencia).
--
--   3) ordenes_fabricacion_cliente.telefono: teléfono de contacto para el
--      despacho. Lo traerá la sincronización desde la dirección de envío de
--      Shopify, así no hay que adivinarlo dentro de la nota libre. Es un
--      dato personal: vive junto a los demás, en la tabla que solo leen
--      administrador y bodega.
--
-- NO se tocan las tablas ni funciones del flujo antiguo (pedidos,
-- pedido_items, crear_pedido, avanzar_estado_pedido...): quedan sin uso
-- hasta la limpieza final.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Columnas nuevas
-- ------------------------------------------------------------
alter table ordenes_fabricacion
  add column origen text
    constraint ordenes_fabricacion_origen_valido check (origen in ('tienda_en_linea', 'manual_shopify')),
  add column origen_shopify text,
  add column despachado_en timestamptz;

create index ordenes_fabricacion_origen_idx on ordenes_fabricacion (origen);

alter table ordenes_fabricacion_cliente
  add column telefono text;


-- ------------------------------------------------------------
-- 2) Normalización: agrega la regla del origen
-- ------------------------------------------------------------
-- Misma función de la 0012 (fecha en hora de Chile, color, tipo y
-- es_adicional, región y comuna) con un bloque nuevo al final: el origen.
create or replace function public.normalizar_orden_fabricacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text;
  v_comuna comunas_chile%rowtype;
begin
  -- Día del pedido en hora de Chile (no en UTC: un pedido de las 22:00
  -- del día 31 no puede contarse como día 1 del mes siguiente).
  new.fecha_pedido := (new.pedido_creado_en at time zone 'America/Santiago')::date;

  -- Color: solo tildes, mayúsculas y espacios.
  new.color := nullif(upper(btrim(regexp_replace(quitar_tildes(new.color), '\s+', ' ', 'g'))), '');

  -- Tipo: forma canónica de los tipos conocidos; el resto, en mayúsculas.
  new.tipo := case clave_busqueda(new.tipo)
    when 'sofa' then 'SOFÁ'
    when 'sofa en l' then 'SOFÁ EN L'
    when 'sofa cama' then 'SOFÁ CAMA'
    when 'poltrona' then 'POLTRONA'
    when 'cojin' then 'COJÍN'
    else nullif(upper(btrim(new.tipo)), '')
  end;
  new.es_adicional := new.tipo is null
    or new.tipo not in ('SOFÁ', 'SOFÁ EN L', 'SOFÁ CAMA', 'POLTRONA');

  -- Región y comuna.
  new.region := nullif(btrim(new.region), '');
  new.comuna_revisar := false;
  v_clave := clave_busqueda(new.comuna);

  if v_clave is null then
    new.comuna := null;
  elsif v_clave = 'retiro tienda' then
    new.comuna := 'RETIRO TIENDA';
  elsif v_clave = clave_busqueda('NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO') then
    new.comuna := 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO';
  else
    select * into v_comuna from comunas_chile where clave = v_clave;
    if found then
      new.comuna := v_comuna.nombre;
      new.region := v_comuna.region;
    else
      new.comuna := btrim(new.comuna);
      new.comuna_revisar := true;
    end if;
  end if;

  -- Origen: "web" es la tienda en línea; cualquier otro valor del origen
  -- de Shopify (pedido de borrador, POS, app móvil, apps externas) es un
  -- pedido manual. Si Shopify no informó el origen, se respeta lo que
  -- haya (normalmente vacío).
  new.origen_shopify := nullif(btrim(new.origen_shopify), '');
  if new.origen_shopify is not null then
    new.origen := case
      when lower(new.origen_shopify) = 'web' then 'tienda_en_linea'
      else 'manual_shopify'
    end;
  end if;

  return new;
end;
$$;

-- El trigger ahora también debe dispararse al cambiar origen_shopify.
drop trigger ordenes_fabricacion_normalizar on ordenes_fabricacion;

create trigger ordenes_fabricacion_normalizar
  before insert or update of tipo, color, region, comuna, pedido_creado_en, origen_shopify
  on ordenes_fabricacion
  for each row execute function normalizar_orden_fabricacion();


-- ------------------------------------------------------------
-- 3) avanzar_estado_orden: guardar cuándo salió a despacho
-- ------------------------------------------------------------
-- Misma función de la 0012; lo único nuevo es despachado_en.
create or replace function public.avanzar_estado_orden(p_orden_id uuid)
returns estado_orden_fabricacion
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden ordenes_fabricacion;
  v_siguiente estado_orden_fabricacion;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar órdenes de fabricación.'
      using errcode = '42501';
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

  v_siguiente := case v_orden.estado
    when 'fabricado' then 'en_despacho'
    when 'en_despacho' then 'entregado'
    else null
  end;

  if v_siguiente is null then
    raise exception 'La orden % está en "%": solo avanza desde "fabricado" o "en despacho" (por fabricar se resuelve marcando LISTO).',
      v_orden.numero, v_orden.estado
      using errcode = 'P0001';
  end if;

  update ordenes_fabricacion
  set estado = v_siguiente,
      -- Solo al salir a despacho; al pasar a "entregado" se conserva.
      despachado_en = case when v_siguiente = 'en_despacho' then now() else despachado_en end,
      actualizado_en = now()
  where id = p_orden_id;

  return v_siguiente;
end;
$$;

revoke execute on function public.avanzar_estado_orden(uuid) from public, anon;
grant execute on function public.avanzar_estado_orden(uuid) to authenticated;
