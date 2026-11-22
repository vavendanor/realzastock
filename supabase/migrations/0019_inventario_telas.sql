-- ============================================================
-- Inventario de telas (metros) con stock mínimo
-- ============================================================
-- Depende de 0001 a 0018. NO toca ninguna tabla existente.
--
-- Crea UNA tabla nueva, "telas", con las 4 telas que se llevan en metros:
-- Lino, Cuero, Semicuero y Tela hidrorepelente. Cada una tiene su cantidad en
-- metros y su stock mínimo (el aviso de "stock bajo" salta cuando la cantidad
-- es igual o menor al mínimo).
--
-- Quién accede: SOLO el administrador (ni bodega, ni vendedor, ni anónimo).
--   * Leer: política de RLS (rol_actual() = 'administrador').
--   * Cambiar cantidad o mínimo: solo con la función ajustar_tela(), que valida
--     el rol y que los números no sean negativos. No hay permiso de escribir
--     directo en la tabla, y tampoco de agregar ni borrar telas: son estas 4.
--
-- Datos iniciales: 100 metros de cada tela y un mínimo de 30. Se insertan con
-- "on conflict do nothing": si se vuelve a correr, no pisa lo que ya se ajustó.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) La tabla
-- ------------------------------------------------------------
create table public.telas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  metros numeric(10, 2) not null default 0 check (metros >= 0),
  stock_minimo numeric(10, 2) not null default 0 check (stock_minimo >= 0),
  actualizado_en timestamptz not null default now()
);

alter table public.telas enable row level security;

create policy telas_select_admin on public.telas
  for select to authenticated using (rol_actual() = 'administrador');

-- Solo lectura por la API; las escrituras pasan por ajustar_tela().
revoke all on public.telas from public, anon;
revoke insert, update, delete, truncate on public.telas from authenticated;
grant select on public.telas to authenticated;


-- ------------------------------------------------------------
-- 2) Datos iniciales
-- ------------------------------------------------------------
insert into public.telas (nombre, metros, stock_minimo) values
  ('Lino', 100, 30),
  ('Cuero', 100, 30),
  ('Semicuero', 100, 30),
  ('Tela hidrorepelente', 100, 30)
on conflict (nombre) do nothing;


-- ------------------------------------------------------------
-- 3) Ajustar la cantidad y el mínimo de una tela
-- ------------------------------------------------------------
create or replace function public.ajustar_tela(p_tela_id uuid, p_metros numeric, p_stock_minimo numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if rol_actual() is distinct from 'administrador' then
    raise exception 'Solo el administrador puede ajustar el inventario de telas.'
      using errcode = '42501';
  end if;

  if p_metros is null or p_stock_minimo is null or p_metros < 0 or p_stock_minimo < 0 then
    raise exception 'Los metros y el mínimo deben ser números de 0 o más.'
      using errcode = '22023';
  end if;

  update telas
  set metros = round(p_metros, 2), stock_minimo = round(p_stock_minimo, 2), actualizado_en = now()
  where id = p_tela_id;

  if not found then
    raise exception 'La tela indicada no existe.'
      using errcode = '23503';
  end if;
end;
$$;

revoke execute on function public.ajustar_tela(uuid, numeric, numeric) from public, anon;
grant execute on function public.ajustar_tela(uuid, numeric, numeric) to authenticated;
