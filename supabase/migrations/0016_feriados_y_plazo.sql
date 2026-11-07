-- ============================================================
-- Feriados de Chile y fecha de inicio del plazo de fabricación
-- ============================================================
-- Depende de 0001 a 0015.
--
-- La lista de pedidos pendientes del taller cuenta los DÍAS HÁBILES que lleva
-- cada pedido (de lunes a viernes, sin feriados) contra un plazo máximo de 14.
-- Esta migración deja en la base de datos las dos cosas que ese cálculo
-- necesita:
--
--   1) feriados_chile: el calendario de feriados nacionales (2026 y 2027).
--      Todos los feriados legales, también los que caen en fin de semana: no
--      cambian el conteo, pero así la tabla se puede comparar de una mirada con
--      el calendario oficial (16 en 2026 y 17 en 2027).
--
--   2) ordenes_fabricacion.plazo_desde: la fecha desde la que se cuenta el
--      plazo cuando NO es la del pedido (por ejemplo, el cliente pagó en la
--      sala de ventas dos días después de crear el pedido). Vacía = se cuenta
--      desde fecha_pedido. La sincronización con Shopify nunca la toca.
--
-- Cómo se cuenta (validado con la lista del taller del 31-10-2026: 89 de 89
-- filas): los días hábiles transcurridos son los de lunes a viernes, sin
-- feriados, DESDE EL DÍA SIGUIENTE al inicio hasta la fecha de corte inclusive.
--   Faltantes = máx(0, 14 - transcurridos)    Retraso = máx(0, transcurridos - 14)
--
-- Fuente de los feriados: Biblioteca del Congreso Nacional, "Legislación
-- temática - Feriados" (https://www.bcn.cl/leychile/Consulta/listado_n_sel?agr=2&sub=1151).
-- Reglas de traslado aplicadas: Ley 19.668 (San Pedro y San Pablo y Encuentro
-- de Dos Mundos pasan al lunes), Ley 20.983 (el viernes 17 de septiembre es
-- feriado cuando el 18 y el 19 caen en sábado y domingo) y Ley 21.357 (Día
-- Nacional de los Pueblos Indígenas: el día del solsticio de invierno).
--
-- ATENCIÓN: el Día Nacional de los Pueblos Indígenas NO tiene fecha fija: es el
-- día del solsticio de invierno, y cambia de un año a otro. Aquí quedó el
-- domingo 21-jun-2026 y el LUNES 21-jun-2027 (el solsticio de 2027 ocurre el
-- 21-jun a las ~10:11 hora de Chile). Esa fecha de 2027 afecta el conteo de
-- días hábiles porque cae en día de semana: hay que CONFIRMARLA contra el
-- calendario oficial del Gobierno de Chile, y lo mismo vale para cada año
-- nuevo que se cargue (el solsticio puede caer entre el 20 y el 21 de junio).
--
-- No se cargan los feriados regionales (7 de junio en Arica, 20 de agosto en
-- Chillán) ni feriados de una sola vez (elecciones): si aparece uno, se agrega
-- con el INSERT de más abajo.
--
-- Para AGREGAR un feriado o cargar un año nuevo (SQL Editor):
--     insert into feriados_chile (fecha, nombre) values ('2028-01-01', 'Año Nuevo');
-- Para quitar uno por error:
--     delete from feriados_chile where fecha = '2026-12-08';
-- OJO: la app avisa cuando el año de un cálculo no tiene feriados cargados; hay
-- que cargar 2028 antes de que termine 2027.
--
-- Fecha de inicio manual (la función la usará la pantalla de hojas; mientras
-- tanto se puede fijar desde el SQL Editor, p. ej. para el pedido 1277 que se
-- pagó en la sala de ventas el 22-10):
--     update ordenes_fabricacion set plazo_desde = '2026-10-22' where pedido_numero = '1277';
--
-- Es compatible hacia atrás: no cambia ninguna tabla, función ni consulta
-- existente (la app y la Edge Function actuales siguen funcionando igual).
--
-- Para DESHACER esta migración:
--     drop function public.fijar_inicio_plazo(text, date);
--     alter table ordenes_fabricacion drop column plazo_desde;
--     drop table feriados_chile;
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) feriados_chile
-- ------------------------------------------------------------
create table feriados_chile (
  fecha date primary key,
  nombre text not null check (btrim(nombre) <> ''),
  constraint feriados_chile_fecha_razonable check (fecha between date '2020-01-01' and date '2100-12-31')
);

alter table feriados_chile enable row level security;

-- Solo lectura desde la app, para quienes trabajan con producción (la misma
-- regla que ordenes_fabricacion). Se edita desde el SQL Editor.
create policy feriados_chile_select on feriados_chile
  for select to authenticated
  using (tiene_acceso_produccion());

revoke all on feriados_chile from anon;
revoke insert, update, delete, truncate on feriados_chile from authenticated;

insert into feriados_chile (fecha, nombre) values
  -- 2026 (16: 10 en día de semana y 6 en fin de semana)
  ('2026-01-01', 'Año Nuevo'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-04-04', 'Sábado Santo'),
  ('2026-05-01', 'Día del Trabajo'),
  ('2026-05-21', 'Día de las Glorias Navales'),
  ('2026-06-21', 'Día Nacional de los Pueblos Indígenas'),
  ('2026-06-29', 'San Pedro y San Pablo'),
  ('2026-07-16', 'Día de la Virgen del Carmen'),
  ('2026-08-15', 'Asunción de la Virgen'),
  ('2026-09-18', 'Independencia Nacional'),
  ('2026-09-19', 'Día de las Glorias del Ejército'),
  ('2026-10-12', 'Encuentro de Dos Mundos'),
  ('2026-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2026-11-01', 'Día de Todos los Santos'),
  ('2026-12-08', 'Inmaculada Concepción'),
  ('2026-12-25', 'Navidad'),
  -- 2027 (17: 10 en día de semana y 7 en fin de semana)
  ('2027-01-01', 'Año Nuevo'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-03-27', 'Sábado Santo'),
  ('2027-05-01', 'Día del Trabajo'),
  ('2027-05-21', 'Día de las Glorias Navales'),
  ('2027-06-21', 'Día Nacional de los Pueblos Indígenas'),
  ('2027-06-28', 'San Pedro y San Pablo'),
  ('2027-07-16', 'Día de la Virgen del Carmen'),
  ('2027-08-15', 'Asunción de la Virgen'),
  ('2027-09-17', 'Feriado de Fiestas Patrias (Ley 20.983)'),
  ('2027-09-18', 'Independencia Nacional'),
  ('2027-09-19', 'Día de las Glorias del Ejército'),
  ('2027-10-11', 'Encuentro de Dos Mundos'),
  ('2027-10-31', 'Día de las Iglesias Evangélicas y Protestantes'),
  ('2027-11-01', 'Día de Todos los Santos'),
  ('2027-12-08', 'Inmaculada Concepción'),
  ('2027-12-25', 'Navidad');


-- ------------------------------------------------------------
-- 2) ordenes_fabricacion.plazo_desde
-- ------------------------------------------------------------
-- Nullable y sin valor por defecto: así ninguna fila existente cambia. El
-- trigger de normalización no se dispara con esta columna, y la
-- sincronización no la escribe nunca.
alter table ordenes_fabricacion add column plazo_desde date;

comment on column ordenes_fabricacion.plazo_desde is
  'Fecha desde la que se cuenta el plazo de fabricación si no es la del pedido (fecha_pedido). NULL = se cuenta desde fecha_pedido. La sincronización con Shopify no la toca.';


-- ------------------------------------------------------------
-- 3) fijar_inicio_plazo: cambiar (o quitar) la fecha de inicio de un pedido
-- ------------------------------------------------------------
-- Se aplica a TODAS las piezas activas del pedido (el plazo es del pedido).
-- p_fecha = null, o igual a la fecha del pedido, vuelve a contar desde el
-- pedido. No puede ser anterior a la fecha del pedido ni futura. Devuelve
-- cuántas piezas actualizó. Mismo permiso que el resto de producción
-- (administrador y bodega).
create or replace function public.fijar_inicio_plazo(p_pedido_numero text, p_fecha date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pedido text := btrim(p_pedido_numero);
  v_desde date;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_filas integer;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar órdenes de fabricación.'
      using errcode = '42501';
  end if;

  if v_pedido is null or v_pedido = '' then
    raise exception 'Indica el número de pedido.'
      using errcode = '22023';
  end if;

  select min(fecha_pedido) into v_desde
  from ordenes_fabricacion
  where pedido_numero = v_pedido and cancelado_en is null;

  if v_desde is null then
    raise exception 'No hay órdenes activas del pedido %.', v_pedido
      using errcode = '23503';
  end if;

  if p_fecha is not null then
    if p_fecha < v_desde then
      raise exception 'El inicio del plazo no puede ser anterior a la fecha del pedido (%).', to_char(v_desde, 'DD-MM-YYYY')
        using errcode = '22023';
    end if;
    if p_fecha > v_hoy then
      raise exception 'El inicio del plazo no puede ser una fecha futura.'
        using errcode = '22023';
    end if;
  end if;

  update ordenes_fabricacion
  set plazo_desde = case when p_fecha = fecha_pedido then null else p_fecha end,
      actualizado_en = now()
  where pedido_numero = v_pedido and cancelado_en is null;

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

revoke execute on function public.fijar_inicio_plazo(text, date) from public, anon;
grant execute on function public.fijar_inicio_plazo(text, date) to authenticated;
