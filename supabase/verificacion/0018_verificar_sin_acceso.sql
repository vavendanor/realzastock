-- Verificación de la 0018 (despachos) como alguien SIN acceso: vendedor o anónimo.
-- Termina SIEMPRE con un error que muestra el informe y revierte todo: no queda ningún dato.
do $verificacion$
declare
  v_quien text := 'vendedor';      -- cambia a 'anon' para la segunda corrida
  v_uid uuid;
  v_orden uuid;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_informe text := '';
  v_fallas integer := 0;
  v_ok boolean;
  v_n integer;
begin
  select id into v_orden from ordenes_fabricacion where cancelado_en is null limit 1;
  if v_quien = 'vendedor' then
    select id into v_uid from usuarios where rol::text = 'vendedor' limit 1;
    if v_uid is null then raise exception 'No hay ningún usuario con rol vendedor.'; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  else
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
  end if;

  -- Tanto "No tienes permiso" (vendedor) como "permission denied" (anónimo) cuentan como rechazo.
  begin perform programar_despacho(array[v_orden], v_hoy + 1); v_ok := false;
  exception when others then v_ok := sqlerrm like '%No tienes permiso%' or sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede programar un despacho' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin perform quitar_despacho_programado(array[v_orden]); v_ok := false;
  exception when others then v_ok := sqlerrm like '%No tienes permiso%' or sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede quitar la fecha de un despacho' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin perform marcar_despachado(array[v_orden]); v_ok := false;
  exception when others then v_ok := sqlerrm like '%No tienes permiso%' or sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede marcar un mueble como despachado' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- Lectura: el vendedor ve 0 filas (RLS); el anónimo ni siquiera tiene permiso.
  begin select count(*) into v_n from ordenes_fabricacion where despacho_programado is not null; v_ok := v_n = 0;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no ve ningún mueble con despacho programado' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin update ordenes_fabricacion set despacho_programado = v_hoy; v_ok := false;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede escribir directo en la tabla' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  raise exception E'VERIFICACIÓN 0018 · %\n%\nFallas: %\n(Todo se revirtió: no quedó ningún dato.)', v_quien, v_informe, v_fallas;
end
$verificacion$;
