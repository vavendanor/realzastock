-- ============================================================
-- Esquema inicial: Sistema de Gestión de Inventario, Ventas y
-- Pedidos — Realza Hogar
-- ============================================================
-- Basado en el diagrama entidad-relación revisado en el informe
-- U1. Todas las relaciones son 1 a N; los N a N (ventas<->variantes,
-- pedidos<->variantes) se resuelven con tablas intermedias
-- (venta_items, pedido_items).
--
-- Cómo aplicarlo:
--   Opción A: pega este archivo completo en Supabase ->
--             SQL Editor -> New query -> Run.
--   Opción B: pídele a Claude Code que lo guarde como
--             supabase/migrations/0001_schema_inicial.sql
--             y lo aplique con la CLI de Supabase.
-- ============================================================

-- Tipos enumerados: restringen los valores posibles a nivel de
-- base de datos (evita strings sueltos como "vendedro" mal escrito)
create type rol_usuario as enum ('administrador', 'vendedor', 'bodega');
create type ubicacion_stock as enum ('bodega', 'showroom');
create type estado_pedido as enum ('pendiente', 'en_preparacion', 'despachado', 'entregado');
create type canal_venta as enum ('online', 'showroom');

-- ------------------------------------------------------------
-- USUARIOS
-- Se vincula 1 a 1 con auth.users (la tabla de autenticación
-- que Supabase ya trae integrada) para poder guardar el rol.
-- ------------------------------------------------------------
create table usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  email text not null unique,
  rol rol_usuario not null default 'vendedor',
  creado_en timestamptz not null default now()
);

-- ------------------------------------------------------------
-- PRODUCTOS
-- Las líneas base: Osorno, Valencia, Chillán, Villarrica, Frutillar
-- ------------------------------------------------------------
create table productos (
  id uuid primary key default gen_random_uuid(),
  modelo text not null,
  descripcion text,
  creado_en timestamptz not null default now()
);

-- ------------------------------------------------------------
-- VARIANTES
-- Combinación vendible real: producto + color + material
-- ------------------------------------------------------------
create table variantes (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  color text not null,
  material text not null,
  sku text not null unique,
  precio numeric(12, 2) not null check (precio >= 0),
  creado_en timestamptz not null default now()
);

-- ------------------------------------------------------------
-- INVENTARIO
-- Stock de cada variante, separado por ubicación
-- ------------------------------------------------------------
create table inventario (
  id uuid primary key default gen_random_uuid(),
  variante_id uuid not null references variantes(id) on delete cascade,
  ubicacion ubicacion_stock not null,
  cantidad integer not null default 0 check (cantidad >= 0),
  actualizado_en timestamptz not null default now(),
  -- no puede haber dos filas de stock para la misma variante
  -- en la misma ubicación
  unique (variante_id, ubicacion)
);

-- ------------------------------------------------------------
-- VENTAS (cabecera) + VENTA_ITEMS (detalle)
-- Una venta puede incluir varias variantes distintas
-- ------------------------------------------------------------
create table ventas (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references usuarios(id),
  canal canal_venta not null,
  fecha timestamptz not null default now()
);

create table venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas(id) on delete cascade,
  variante_id uuid not null references variantes(id),
  cantidad integer not null check (cantidad > 0),
  precio_unitario numeric(12, 2) not null check (precio_unitario >= 0)
);

-- ------------------------------------------------------------
-- PEDIDOS (cabecera) + PEDIDO_ITEMS (detalle)
-- ------------------------------------------------------------
create table pedidos (
  id uuid primary key default gen_random_uuid(),
  responsable_id uuid not null references usuarios(id),
  cliente_nombre text not null,
  cliente_contacto text,
  estado estado_pedido not null default 'pendiente',
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now()
);

create table pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id) on delete cascade,
  variante_id uuid not null references variantes(id),
  cantidad integer not null check (cantidad > 0)
);

-- ------------------------------------------------------------
-- Índices para las consultas más frecuentes
-- (buscar stock/ventas/pedidos por variante es lo más común)
-- ------------------------------------------------------------
create index idx_variantes_producto on variantes(producto_id);
create index idx_inventario_variante on inventario(variante_id);
create index idx_venta_items_venta on venta_items(venta_id);
create index idx_venta_items_variante on venta_items(variante_id);
create index idx_pedido_items_pedido on pedido_items(pedido_id);
create index idx_pedido_items_variante on pedido_items(variante_id);
create index idx_pedidos_estado on pedidos(estado);

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- Supabase exige activar RLS explícitamente en cada tabla, o
-- por defecto nadie (ni siquiera un usuario logueado) puede
-- leer/escribir. Por ahora solo lo activamos; las políticas
-- específicas por rol (dueño/vendedor/bodega) las definimos
-- en el siguiente paso, junto con la autenticación.
-- ------------------------------------------------------------
alter table usuarios enable row level security;
alter table productos enable row level security;
alter table variantes enable row level security;
alter table inventario enable row level security;
alter table ventas enable row level security;
alter table venta_items enable row level security;
alter table pedidos enable row level security;
alter table pedido_items enable row level security;
