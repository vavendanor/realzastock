-- Verificación de la 0018 (despachos) como administrador o bodega.
-- Termina SIEMPRE con un error que muestra el informe y revierte todo: no queda ningún dato.
-- Necesita 2 muebles fabricados, 1 por fabricar y 1 en despacho (sirven los pedidos de prueba:
-- supabase/verificacion/despachos_de_prueba_insertar.sql).
do $verificacion$
declare
  v_rol text := 'administrador';   -- cambia a 'bodega' para la segunda corrida
  v_uid uuid;
  v_a uuid; v_b uuid; v_pf uuid; v_desp uuid;
  v_hoy date := (now() at time zone 'America/Santiago')::date;
  v_informe text := '';
  v_fallas integer := 0;
  v_ok boolean;
  v_n integer;
  v_det text;
  v_f ordenes_fabricacion;
begin
  select id into v_uid from usuarios where rol::text = v_rol limit 1;
  if v_uid is null then raise exception 'No hay ningún usuario con rol %.', v_rol; end if;

  select id into v_a from ordenes_fabricacion where estado = 'fabricado' and cancelado_en is null order by numero limit 1;
  select id into v_b from ordenes_fabricacion where estado = 'fabricado' and cancelado_en is null and id <> v_a order by numero limit 1;
  select id into v_pf from ordenes_fabricacion where estado = 'por_fabricar' and cancelado_en is null and not es_adicional order by numero limit 1;
  select id into v_desp from ordenes_fabricacion where estado = 'en_despacho' and cancelado_en is null order by numero limit 1;
  if v_a is null or v_b is null or v_pf is null or v_desp is null then
    raise exception 'Faltan datos para probar: se necesitan 2 muebles fabricados, 1 por fabricar y 1 en despacho (ejecuta despachos_de_prueba_insertar.sql).';
  end if;

  -- A partir de aquí se actúa como ese usuario (igual que lo haría la app).
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1) programar 2 muebles para mañana
  begin v_n := programar_despacho(array[v_a, v_b], v_hoy + 1); v_ok := v_n = 2; exception when others then v_ok := false; v_det := sqlerrm; end;
  v_ok := v_ok and (select count(*) from ordenes_fabricacion where id in (v_a, v_b) and despacho_programado = v_hoy + 1) = 2;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'programar 2 muebles fabricados para mañana' || case when v_ok then '' else ' -> ' || coalesce(v_det, '') end || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 2) fecha pasada
  begin perform programar_despacho(array[v_a], v_hoy - 1); v_ok := false; exception when others then v_ok := sqlerrm like '%anterior a hoy%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'una fecha pasada se rechaza' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 3) un mueble por fabricar o en despacho: se rechaza todo
  begin perform programar_despacho(array[v_a, v_pf], v_hoy + 2); v_ok := false; exception when others then v_ok := sqlerrm like '%Solo se programan muebles fabricados%'; end;
  v_ok := v_ok and (select despacho_programado from ordenes_fabricacion where id = v_a) = v_hoy + 1;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'un mueble por fabricar en la lista: no se programa ninguno' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;
  begin perform programar_despacho(array[v_desp], v_hoy + 2); v_ok := false; exception when others then v_ok := sqlerrm like '%Solo se programan muebles fabricados%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'un mueble que ya está en despacho no se programa' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 4) quitar la fecha de uno
  begin v_n := quitar_despacho_programado(array[v_b]); v_ok := v_n = 1 and (select despacho_programado from ordenes_fabricacion where id = v_b) is null; exception when others then v_ok := false; v_det := sqlerrm; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'quitar la fecha programada de un mueble' || case when v_ok then '' else ' -> ' || coalesce(v_det, '') end || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 5) marcar despachado: pasa a en despacho, guarda cuándo salió y conserva (o pone) la fecha
  begin v_n := marcar_despachado(array[v_a, v_b]); v_ok := v_n = 2; exception when others then v_ok := false; v_det := sqlerrm; end;
  select * into v_f from ordenes_fabricacion where id = v_a;
  v_ok := v_ok and v_f.estado = 'en_despacho' and v_f.despachado_en is not null and v_f.despacho_programado = v_hoy + 1;
  select * into v_f from ordenes_fabricacion where id = v_b;
  v_ok := v_ok and v_f.estado = 'en_despacho' and v_f.despachado_en is not null and v_f.despacho_programado = v_hoy;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'marcar despachados: pasan a en despacho; uno conserva su fecha y el otro queda con la de hoy' || case when v_ok then '' else ' -> ' || coalesce(v_det, '') end || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 6) un mueble que ya está en despacho no avanza ni pierde la fecha
  begin perform marcar_despachado(array[v_a]); v_ok := false; exception when others then v_ok := sqlerrm like '%Solo se despachan muebles fabricados%'; end;
  begin perform quitar_despacho_programado(array[v_a]); v_ok := false; exception when others then v_ok := v_ok and sqlerrm like '%Ya salieron a despacho%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'uno que ya salió: no se vuelve a despachar ni se le quita la fecha' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 7) la escritura directa sigue prohibida
  begin update ordenes_fabricacion set despacho_programado = v_hoy where id = v_pf; v_ok := false; exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'cambiar la fecha directo en la tabla: sin permiso' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  raise exception E'VERIFICACIÓN 0018 · rol %\n%\nFallas: %\n(Todo se revirtió: no quedó ningún dato.)', v_rol, v_informe, v_fallas;
end
$verificacion$;
