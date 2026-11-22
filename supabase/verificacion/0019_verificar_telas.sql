-- Verificación de la 0019 (inventario de telas) por rol. Cambia v_quien y corre una vez por rol:
-- 'administrador', 'bodega', 'vendedor' y 'anon'. Termina SIEMPRE con un error que muestra el informe
-- y revierte todo: no queda ningún cambio en las telas.
do $verificacion$
declare
  v_quien text := 'administrador';
  v_uid uuid;
  v_tela uuid;
  v_informe text := '';
  v_fallas integer := 0;
  v_ok boolean;
  v_n integer;
  v_es_admin boolean;
begin
  select id into v_tela from telas where nombre = 'Lino';
  v_es_admin := v_quien = 'administrador';
  if v_quien = 'anon' then
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role anon';
  else
    select id into v_uid from usuarios where rol::text = v_quien limit 1;
    if v_uid is null then raise exception 'No hay ningún usuario con rol %.', v_quien; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;

  -- Lectura: el administrador ve las 4 telas; los demás, ninguna (o ni siquiera tienen permiso).
  begin select count(*) into v_n from telas; v_ok := case when v_es_admin then v_n = 4 else v_n = 0 end;
  exception when others then v_ok := not v_es_admin and sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || case when v_es_admin then 've las 4 telas' else 'no ve ninguna tela' end || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- Ajustar con la función: solo el administrador.
  begin perform ajustar_tela(v_tela, 80, 25); v_ok := v_es_admin;
  exception when others then v_ok := not v_es_admin and (sqlerrm like '%Solo el administrador%' or sqlerrm like '%permission denied%'); end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || case when v_es_admin then 'puede ajustar la cantidad y el mínimo' else 'no puede ajustar una tela' end || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  -- Números negativos: se rechazan incluso para el administrador.
  if v_es_admin then
    begin perform ajustar_tela(v_tela, -1, 30); v_ok := false;
    exception when others then v_ok := sqlerrm like '%0 o más%'; end;
    v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'rechaza metros negativos' || E'\n';
    if not v_ok then v_fallas := v_fallas + 1; end if;
  end if;

  -- Escribir directo en la tabla: nadie.
  begin update telas set metros = 5; v_ok := false;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede escribir directo en la tabla' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  begin delete from telas; v_ok := false;
  exception when others then v_ok := sqlerrm like '%permission denied%'; end;
  v_informe := v_informe || case when v_ok then 'OK     ' else 'FALLA  ' end || 'no puede borrar telas' || E'\n';
  if not v_ok then v_fallas := v_fallas + 1; end if;

  execute 'reset role';
  raise exception E'\n\nVerificación 0019 como %:\n%\n% fallas. (Este error es a propósito: revierte todo.)', v_quien, v_informe, v_fallas;
end
$verificacion$;
