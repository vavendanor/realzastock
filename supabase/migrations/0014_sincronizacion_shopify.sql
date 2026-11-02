-- ============================================================
-- Sincronización con Shopify: control de la corrida y programación
-- ============================================================
-- Depende de 0001 a 0013.
--
-- La Edge Function "sincronizar-shopify" lee los pedidos de Shopify y los
-- guarda como órdenes de fabricación. Esta migración le da lo que necesita
-- del lado de la base de datos:
--
--   PARTE 1 (funciones de control)
--     * sync_shopify.en_curso_desde: marca "hay una sincronización en
--       marcha", para que dos corridas nunca se pisen (por ejemplo, el cron
--       y un administrador a la vez).
--     * reservar_sync_shopify(): toma esa marca de forma atómica y devuelve
--       desde dónde sincronizar. Si ya hay una corrida en marcha, no
--       devuelve nada. Una marca de más de 10 minutos se considera
--       abandonada (la corrida se cayó) y se puede volver a tomar.
--     * finalizar_sync_shopify(): registra el avance, el último error y
--       libera la marca. La fecha de última sincronización solo avanza,
--       nunca retrocede.
--     Solo las puede ejecutar la Edge Function (rol service_role): ni la
--     app ni usuarios autenticados.
--
--   PARTE 2 (programación)
--     * Habilita pg_cron y pg_net y programa una llamada a la Edge Function
--       cada 5 minutos. La llamada lleva el header x-cron-secret con el valor
--       del secreto "cron_secret_shopify" guardado en el Vault.
--
-- ANTES de ejecutar la PARTE 2, en este orden (ver las instrucciones que te
-- dio Claude):
--   1) Crear los secretos de la Edge Function (SHOPIFY_SHOP,
--      SHOPIFY_ACCESS_TOKEN y CRON_SECRET) y desplegar la función con
--      "Verify JWT" desactivado.
--   2) Probar la función a mano: primero con ?dry=1 y luego la primera carga
--      real.
--   3) Crear en el Vault (Database -> Vault) el secreto "cron_secret_shopify"
--      con EL MISMO valor que CRON_SECRET.
-- Si ejecutas la 0014 completa antes de tener el secreto en el Vault, el
-- cron igual se programa, pero la función rechazará cada llamada (401) hasta
-- que el secreto exista.
--
-- Para pausar la sincronización automática:
--     select cron.unschedule('sincronizar-shopify');
-- Para ver cómo le va al cron:
--     select * from cron.job_run_details order by start_time desc limit 10;
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ============================================================
-- PARTE 1: funciones de control
-- ============================================================

alter table sync_shopify
  add column if not exists en_curso_desde timestamptz;

-- Toma la marca de "sincronización en curso". Devuelve una fila (desde cuándo
-- importar y cuál fue la última sincronización) si la tomó, o ninguna fila si
-- ya hay otra corrida en marcha.
create or replace function public.reservar_sync_shopify(p_minutos_maximo integer default 10)
returns table (importar_desde date, ultima_sincronizacion timestamptz)
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
  returning s.importar_desde, s.ultima_sincronizacion;
end;
$$;

-- Registra cómo terminó la corrida y libera la marca.
--   p_ultima: hasta dónde llegó (NULL = no cambia la fecha guardada).
--   p_ordenes: órdenes escritas en esta corrida.
--   p_error: resumen de errores (NULL o vacío = sin errores).
create or replace function public.finalizar_sync_shopify(
  p_ultima timestamptz,
  p_ordenes integer,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update sync_shopify
  set ultima_sincronizacion = case
        when p_ultima is null then ultima_sincronizacion
        else greatest(coalesce(ultima_sincronizacion, p_ultima), p_ultima)
      end,
      ordenes_ultima_corrida = p_ordenes,
      ultimo_error = nullif(left(coalesce(p_error, ''), 1000), ''),
      en_curso_desde = null
  where id;
end;
$$;

revoke execute on function public.reservar_sync_shopify(integer) from public, anon, authenticated;
revoke execute on function public.finalizar_sync_shopify(timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.reservar_sync_shopify(integer) to service_role;
grant execute on function public.finalizar_sync_shopify(timestamptz, integer, text) to service_role;


-- ============================================================
-- PARTE 2: programación cada 5 minutos
-- ============================================================
-- (Esta parte necesita pg_cron, pg_net y el Vault de Supabase.)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotente: si ya estaba programada, se reemplaza.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sincronizar-shopify') then
    perform cron.unschedule('sincronizar-shopify');
  end if;
end;
$$;

select cron.schedule(
  'sincronizar-shopify',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://hqtgyumuljtzrxrxskao.supabase.co/functions/v1/sincronizar-shopify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_shopify')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
