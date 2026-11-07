-- Verificación de la 0017 como alguien SIN acceso: vendedor o anónimo.
-- Termina SIEMPRE con un error que muestra el informe y revierte todo: no queda ningún dato.
do $verificacion$
declare
  v_quien text := 'vendedor';      -- cambia a 'anon' para la segunda corrida
  v_uid uuid;
  v_orden uuid;
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
  begin perform crear_hoja_fabricacion('Hoja ajena', array['1']); v_ok := false;
  exception when others then v_ok := sqlerrm like '%No tienes permiso%' or sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede crear una hoja' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin perform guardar_cambios_etapas(jsonb_build_array(
          jsonb_build_object('orden_id', v_orden, 'etapa', 'b', 'valor', true, 'esperado', false))); v_ok := false;
  exception when others then v_ok := sqlerrm like '%No tienes permiso%' or sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede guardar cambios de casillas' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin perform agregar_pedidos_a_hoja(gen_random_uuid(), array['1']); v_ok := false;
  exception when others then v_ok := sqlerrm like '%No tienes permiso%' or sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede agregar pedidos a una hoja' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin perform eliminar_hoja_fabricacion(gen_random_uuid()); v_ok := false;
  exception when others then v_ok := sqlerrm like '%No tienes permiso%' or sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede eliminar hojas' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- Lectura: el vendedor ve 0 filas (RLS); el anónimo ni siquiera tiene permiso.
  begin select count(*) into v_n from hojas_fabricacion; v_ok := v_n = 0;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no ve ninguna hoja' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin select count(*) into v_n from hoja_fabricacion_pedidos; v_ok := v_n = 0;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no ve los pedidos de ninguna hoja' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin select count(*) into v_n from hoja_fabricacion_piezas; v_ok := v_n = 0;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no ve las piezas de ninguna hoja (vista)' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin insert into hojas_fabricacion (nombre) values ('directo'); v_ok := false;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede escribir directo en las tablas' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  raise exception E'VERIFICACIÓN 0017 · %\n%\nFallas: %\n(Todo se revirtió: no quedó ningún dato.)', v_quien, v_informe, v_fallas;
end
$verificacion$;
