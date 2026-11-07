-- Verificación de la 0017 como administrador o bodega.
-- Termina SIEMPRE con un error que muestra el informe y revierte todo: no queda ningún dato.
do $verificacion$
declare
  v_rol text := 'administrador';   -- cambia a 'bodega' para la segunda corrida
  v_uid uuid;
  v_pedidos text[];
  v_hoja uuid;
  v_orden uuid;
  v_informe text := '';
  v_fallas integer := 0;
  v_ok boolean;
  v_n integer;
  v_det text;
  v_fila ordenes_fabricacion;
begin
  select id into v_uid from usuarios where rol::text = v_rol limit 1;
  if v_uid is null then raise exception 'No hay ningún usuario con rol %.', v_rol; end if;

  select array_agg(x.p order by x.p) into v_pedidos
  from (select distinct pedido_numero as p from ordenes_fabricacion
        where estado = 'por_fabricar' and cancelado_en is null and not es_adicional
        order by 1 limit 3) x;
  select id into v_orden from ordenes_fabricacion
   where estado = 'por_fabricar' and cancelado_en is null and not es_adicional and not etapa_b
     and pedido_numero = v_pedidos[1] order by numero limit 1;
  if coalesce(array_length(v_pedidos, 1), 0) < 3 or v_orden is null then
    raise exception 'Faltan datos para probar: se necesitan 3 pedidos con piezas por fabricar.';
  end if;

  -- A partir de aquí se actúa como ese usuario (igual que lo haría la app).
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 1) crear una hoja con 2 pedidos
  begin
    v_hoja := crear_hoja_fabricacion('Hoja de prueba', v_pedidos[1:2]);
    v_ok := v_hoja is not null;
  exception when others then v_ok := false; v_det := sqlerrm; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'crear una hoja con 2 pedidos' || case when v_ok then '' else ' -> ' || coalesce(v_det, '') end || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; raise exception E'No se pudo crear la hoja; se detiene.\n%', v_informe; end if;

  -- 2) la hoja y sus pedidos se ven
  select count(*) into v_n from hojas_fabricacion where id = v_hoja;
  v_ok := v_n = 1 and (select count(*) from hoja_fabricacion_pedidos where hoja_id = v_hoja) = 2;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'se ve la hoja y sus 2 pedidos' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 3) la vista trae las piezas en vivo
  select count(*) into v_n from hoja_fabricacion_piezas where hoja_id = v_hoja;
  v_ok := v_n > 0 and not exists (select 1 from hoja_fabricacion_piezas where hoja_id = v_hoja and pedido_numero <> all (v_pedidos[1:2]));
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'la vista trae las piezas de esos pedidos (' || v_n || ' piezas)' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 4) agregar un tercer pedido (y repetirlo no agrega nada)
  v_n := agregar_pedidos_a_hoja(v_hoja, array[v_pedidos[3]]);
  v_ok := v_n = 1 and agregar_pedidos_a_hoja(v_hoja, array[v_pedidos[3]]) = 0;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'agregar un pedido (1) y repetirlo (0)' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 5) quitarlo (y quitarlo de nuevo no es error)
  v_ok := quitar_pedido_de_hoja(v_hoja, v_pedidos[3]) = 1 and quitar_pedido_de_hoja(v_hoja, v_pedidos[3]) = 0;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'quitar un pedido (1) y quitarlo otra vez (0)' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 6) renombrar
  perform renombrar_hoja_fabricacion(v_hoja, '  Hoja renombrada  ');
  v_ok := (select nombre from hojas_fabricacion where id = v_hoja) = 'Hoja renombrada';
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'renombrar (quita los espacios sobrantes)' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 7) nombres inválidos
  begin perform renombrar_hoja_fabricacion(v_hoja, '   '); v_ok := false; exception when others then v_ok := sqlerrm like '%entre 1 y 80%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'rechaza un nombre vacío' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;
  begin perform renombrar_hoja_fabricacion(v_hoja, repeat('x', 81)); v_ok := false; exception when others then v_ok := sqlerrm like '%entre 1 y 80%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'rechaza un nombre de 81 caracteres' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 8) pedido que no existe: error y no se agrega nada
  begin perform agregar_pedidos_a_hoja(v_hoja, array['99999999']); v_ok := false; exception when others then v_ok := sqlerrm like '%No hay órdenes activas%'; end;
  v_ok := v_ok and (select count(*) from hoja_fabricacion_pedidos where hoja_id = v_hoja) = 2;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'un pedido que no existe se rechaza y la hoja no cambia' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 9) guardar una casilla por lotes (B)
  select * into v_fila from guardar_cambios_etapas(jsonb_build_array(
    jsonb_build_object('orden_id', v_orden, 'etapa', 'b', 'valor', true, 'esperado', false)));
  v_ok := v_fila.id = v_orden and v_fila.etapa_b is true;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'guardar B por lotes: devuelve la orden actualizada' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 10) el mismo cambio con un "esperado" que ya no es cierto: conflicto
  begin
    perform guardar_cambios_etapas(jsonb_build_array(
      jsonb_build_object('orden_id', v_orden, 'etapa', 'b', 'valor', true, 'esperado', false)));
    v_ok := false;
  exception when others then
    get stacked diagnostics v_det = pg_exception_detail;
    v_ok := sqlstate = 'P0001' and v_det like '%conflicto%';
  end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'un valor esperado desactualizado se rechaza como "conflicto"' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 11) todo o nada: un cambio válido + uno en conflicto = no se aplica ninguno
  begin
    perform guardar_cambios_etapas(jsonb_build_array(
      jsonb_build_object('orden_id', v_orden, 'etapa', 'i', 'valor', true, 'esperado', false),
      jsonb_build_object('orden_id', v_orden, 'etapa', 'a', 'valor', false, 'esperado', true)));
    v_ok := false;
  exception when others then v_ok := sqlstate = 'P0001'; end;
  v_ok := v_ok and (select etapa_i from ordenes_fabricacion where id = v_orden) is false;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'todo o nada: el cambio válido NO se aplicó porque otro chocó' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 12) LISTO mueve el estado (y desmarcarlo lo devuelve)
  select * into v_fila from guardar_cambios_etapas(jsonb_build_array(
    jsonb_build_object('orden_id', v_orden, 'etapa', 'listo', 'valor', true, 'esperado', false)));
  v_ok := v_fila.estado = 'fabricado' and v_fila.listo and v_fila.listo_origen = 'app' and v_fila.listo_en is not null;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'LISTO: pasa a "fabricado" y queda LISTO por la app' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;
  select * into v_fila from guardar_cambios_etapas(jsonb_build_array(
    jsonb_build_object('orden_id', v_orden, 'etapa', 'listo', 'valor', false, 'esperado', true)));
  v_ok := v_fila.estado = 'por_fabricar' and not v_fila.listo and v_fila.listo_origen is null and v_fila.listo_en is null;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'quitar LISTO: vuelve a "por fabricar"' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 13) la escritura directa sigue prohibida
  begin insert into hojas_fabricacion (nombre) values ('directo'); v_ok := false; exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'insertar una hoja directo en la tabla: sin permiso' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;
  begin update hojas_fabricacion set nombre = 'directo'; v_ok := false; exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'modificar una hoja directo en la tabla: sin permiso' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;
  begin update ordenes_fabricacion set etapa_c = true where id = v_orden; v_ok := false; exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'marcar una casilla directo en ordenes_fabricacion: sin permiso' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- 14) eliminar la hoja: se van sus pedidos, las órdenes quedan intactas
  v_n := eliminar_hoja_fabricacion(v_hoja);   -- en una sentencia aparte: las consultas siguientes deben ver el borrado
  v_ok := v_n = 1
          and (select count(*) from hoja_fabricacion_piezas where hoja_id = v_hoja) = 0
          and (select count(*) from ordenes_fabricacion where pedido_numero = any (v_pedidos)) > 0;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'eliminar la hoja: las órdenes de fabricación siguen ahí' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  raise exception E'VERIFICACIÓN 0017 · rol %\n%\nFallas: %\n(Todo se revirtió: no quedó ningún dato.)', v_rol, v_informe, v_fallas;
end
$verificacion$;
