-- ============================================================
-- Órdenes de fabricación (una fila por mueble) + datos del cliente
-- ============================================================
-- Depende de 0001 a 0011.
--
-- El sistema pasa a ser una herramienta de producción: cada mueble de un
-- pedido de Shopify es una "orden de fabricación" que avanza por cuatro
-- etapas (B, I, A, C), se marca LISTO cuando termina, y luego sigue el
-- despacho. Esta migración crea solo las tablas, la seguridad y las
-- funciones para marcar etapas. La lectura de Shopify (Edge Function) se
-- agrega aparte: esa función escribe con la clave de servicio, que se salta
-- RLS, así que acá no hay políticas de escritura para la app.
--
-- Tablas:
--   ordenes_fabricacion          una fila por mueble (datos de producción).
--   ordenes_fabricacion_cliente  datos PERSONALES (nombre, RUT, teléfono,
--                                correo, dirección). Aparte a propósito:
--                                RLS filtra filas, no columnas. Si el
--                                nombre y el RUT vivieran en la tabla del
--                                listado, cualquier consulta "select *"
--                                los traería. Así, el listado nunca los ve y
--                                solo el detalle de una orden los pide.
--   sync_shopify                 una sola fila: desde cuándo se importa y
--                                cuándo fue la última sincronización.
--
-- Normalización (la hace la base de datos, no la sincronización, para que
-- el resultado sea el mismo escriba quien escriba):
--   * Comuna: se busca en la lista oficial (tabla comunas_chile, generada a
--     partir de src/lib/chile.ts: 16 regiones y 346 comunas) ignorando
--     mayúsculas, tildes y espacios dobles. CONCON y CONCÓN quedan como
--     "Concón"; MAIPU como "Maipú"; SANTIAGO CENTRO como "Santiago". Si la
--     comuna se reconoce, la región también se toma de la lista oficial
--     (la provincia que manda Shopify a veces viene con otro nombre, como
--     "O'Higgins"). Si NO se reconoce, se conserva el texto original y la
--     fila queda con comuna_revisar = true para que alguien lo corrija.
--     "RETIRO TIENDA" y "NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO" se conservan
--     tal cual: no son comunas pero son valores válidos.
--   * Color: solo se unifican tildes, mayúsculas y espacios (MARRÓN y
--     Marron -> MARRON; CAFE CLARO y Café Claro -> CAFE CLARO). No se
--     inventan equivalencias entre colores distintos.
--   * Tipo: SOFA/Sofá -> SOFÁ, COJIN -> COJÍN, etc. Un mueble es
--     cualquier tipo entre SOFÁ, SOFÁ EN L, SOFÁ CAMA y POLTRONA; todo lo
--     demás (patas adicionales, cojines, "10 cm adicional respaldo") se
--     marca es_adicional = true y se importa igual, como una fila más.
--   * fecha_pedido: se calcula desde pedido_creado_en en hora de Chile.
--   * Notas: la nota libre del pedido ("Inf adicional") trae RUT, teléfonos
--     y correos mezclados con instrucciones de entrega. El texto COMPLETO
--     original se guarda solo en ordenes_fabricacion_cliente.inf_adicional;
--     en la orden va notas_produccion, que es la misma nota sin lo que
--     parece RUT, teléfono o correo (función notas_sin_datos_personales).
--
-- Quién accede: administrador y bodega (bodega necesita los datos del
-- cliente para despachar). El vendedor NO ve nada de esto. Toda la lógica
-- de "quién" está en UNA función (tiene_acceso_produccion): cuando el
-- sistema quede solo con el administrador, se cambia ahí y en ningún otro
-- lugar de la base de datos.
--
-- Cómo aplicarlo: Supabase -> SQL Editor -> New query -> Run.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Estado de la orden
-- ------------------------------------------------------------
-- por_fabricar -> fabricado (al marcar LISTO) -> en_despacho -> entregado
create type estado_orden_fabricacion as enum (
  'por_fabricar',
  'fabricado',
  'en_despacho',
  'entregado'
);


-- ------------------------------------------------------------
-- 1b) Funciones de texto para normalizar
-- ------------------------------------------------------------
-- quitar_tildes: solo vocales (con tilde, grave, diéresis y circunflejo);
-- la Ñ se conserva.
create or replace function public.quitar_tildes(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select translate(
    p_texto,
    'áàäâéèëêíìïîóòöôúùüûÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛ',
    'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU'
  );
$$;

-- clave_busqueda: la forma "para comparar": minúsculas, sin tildes, Ñ -> n,
-- espacios múltiples colapsados. Devuelve NULL si queda vacío.
create or replace function public.clave_busqueda(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    btrim(regexp_replace(lower(translate(quitar_tildes(p_texto), 'ñÑ', 'nn')), '\s+', ' ', 'g')),
    ''
  );
$$;


-- notas_sin_datos_personales: de la nota libre del pedido ("Inf adicional"),
-- devuelve solo lo que NO parece RUT, teléfono ni correo. Es lo que se
-- guarda en ordenes_fabricacion.notas_produccion y llega a la hoja de
-- fabricación; el texto completo original queda solo en
-- ordenes_fabricacion_cliente.
--
-- Qué detecta:
--   * Correos: algo@dominio.ext, en cualquier parte del texto.
--   * RUT: con puntos (12.345.678-9), sin puntos con guion (12345678-9),
--     con espacios alrededor del guion, y cualquier RUT escrito después de
--     la palabra "rut"/"run" aunque no tenga guion (123456789).
--   * Teléfonos chilenos: móviles 9 XXXX XXXX con o sin +56/56, con
--     espacios, puntos o guiones; fijos de Santiago 2 XXXX XXXX; y
--     cualquier número de 6 dígitos o más escrito después de palabras como
--     fono, teléfono, cel, celular, móvil, whatsapp, contacto.
--   * Las etiquetas que quedan sueltas ("Rut:", "Fono:", "Correo:") se
--     eliminan junto con su valor, y los separadores ("/") sobrantes se
--     limpian.
--
-- Qué NO detecta (a propósito o por límite): nombres de personas,
-- direcciones, otros documentos (pasaporte), teléfonos fijos de regiones,
-- números de 8 dígitos sin etiqueta, correos escritos con espacios o con la
-- palabra "arroba", y RUT sin guion y sin la palabra "rut" delante. Esos
-- textos pasan a notas_produccion tal cual.
create or replace function public.notas_sin_datos_personales(p_texto text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  t text := p_texto;
  -- Marca temporal (carácter de control) para señalar lo que se borra.
  m constant text := chr(1);
  etiquetas constant text :=
    'rut|run|fono|fonos|tel|tels|tel[eé]fono|tel[eé]fonos|cel|celular|m[oó]vil|movil|whatsapp|wasap|wsp|contacto|correo|mail|e-?mail|email';
begin
  if t is null then
    return null;
  end if;

  -- 1) Correos.
  t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', m, 'g');

  -- 2) RUT.
  t := regexp_replace(t, '(?<![\d.])\d{1,2}\.\d{3}\.\d{3}\s*-?\s*[\dkK](?![\dA-Za-z])', m, 'g');
  t := regexp_replace(t, '(?<!\d)\d{7,8}\s*-\s*[\dkK](?![\dA-Za-z])', m, 'g');
  t := regexp_replace(t, '\y(?:rut|run)\y\s*[:.#-]*\s*\d{1,2}(?:\.?\d{3}){2}\s*-?\s*[\dkK](?![\dA-Za-z])', m, 'gi');

  -- 3) Teléfonos: móvil (9 + 8 dígitos), fijo de Santiago (2 + 8 dígitos)
  --    y números largos después de una etiqueta de teléfono.
  --    Después del 9 (o del 2) vienen 8 dígitos, y entre dos dígitos puede
  --    haber un espacio, punto o guion: así se cubre "9 8765 4321",
  --    "98 765 43 21", "9-8765-4321" y "987654321". El prefijo +56 puede
  --    ir con o sin paréntesis.
  t := regexp_replace(t, '(?<!\d)(?:\(?\+?\s*56\)?[\s.-]*)?9(?:[\s.-]?\d){8}(?!\d)', m, 'g');
  t := regexp_replace(t, '(?<!\d)(?:\(?\+?\s*56\)?[\s.-]*)?\(?2\)?(?:[\s.-]?\d){8}(?!\d)', m, 'g');
  t := regexp_replace(
    t,
    '\y(?:fono|fonos|tel|tels|tel[eé]fono|tel[eé]fonos|cel|celular|m[oó]vil|movil|whatsapp|wasap|wsp|contacto)\y\s*[:.#-]*\s*\+?\s*\d(?:[\s.-]?\d){5,}',
    m, 'gi'
  );

  -- 4) Quitar las etiquetas que quedaron pegadas a lo borrado
  --    ("Rut: <borrado>", "Correo: <borrado>") y valores borrados seguidos
  --    ("<borrado> y <borrado>").
  t := regexp_replace(
    t,
    '(?:\y(?:' || etiquetas || ')\y\s*[:.#-]*\s*)?' || m || '(?:\s*(?:y|e|o|/|,|-)\s*' || m || ')*',
    '', 'gi'
  );
  t := replace(t, m, '');

  -- 5) Limpieza de espacios y separadores sobrantes.
  t := regexp_replace(t, '[ \t]+', ' ', 'g');
  t := regexp_replace(t, '(?:\s*/\s*){2,}', ' / ', 'g');
  t := regexp_replace(t, '(?:\s*,\s*){2,}', ', ', 'g');
  t := regexp_replace(t, '^[\s/,;:|-]+|[\s/,;:|-]+$', '', 'g');

  return nullif(btrim(t), '');
end;
$$;


-- ------------------------------------------------------------
-- 1c) comunas_chile: lista oficial de comunas
-- ------------------------------------------------------------
-- clave   = clave_busqueda(nombre): con lo que se compara.
-- nombre  = nombre oficial (el de src/lib/chile.ts), el que se guarda.
-- region  = región oficial de esa comuna.
-- es_alias = true para nombres alternativos que apuntan a una comuna
--            oficial (hoy: "Santiago Centro" -> "Santiago").
-- Si se cambia src/lib/chile.ts, hay que reflejarlo acá (cambia muy rara
-- vez: es la división político-administrativa del país).
create table comunas_chile (
  clave text primary key,
  nombre text not null,
  region text not null,
  es_alias boolean not null default false
);

insert into comunas_chile (clave, nombre, region, es_alias) values
  ('arica', 'Arica', 'Arica y Parinacota', false),
  ('camarones', 'Camarones', 'Arica y Parinacota', false),
  ('putre', 'Putre', 'Arica y Parinacota', false),
  ('general lagos', 'General Lagos', 'Arica y Parinacota', false),
  ('iquique', 'Iquique', 'Tarapacá', false),
  ('alto hospicio', 'Alto Hospicio', 'Tarapacá', false),
  ('pozo almonte', 'Pozo Almonte', 'Tarapacá', false),
  ('camina', 'Camiña', 'Tarapacá', false),
  ('colchane', 'Colchane', 'Tarapacá', false),
  ('huara', 'Huara', 'Tarapacá', false),
  ('pica', 'Pica', 'Tarapacá', false),
  ('antofagasta', 'Antofagasta', 'Antofagasta', false),
  ('mejillones', 'Mejillones', 'Antofagasta', false),
  ('sierra gorda', 'Sierra Gorda', 'Antofagasta', false),
  ('taltal', 'Taltal', 'Antofagasta', false),
  ('calama', 'Calama', 'Antofagasta', false),
  ('ollague', 'Ollagüe', 'Antofagasta', false),
  ('san pedro de atacama', 'San Pedro de Atacama', 'Antofagasta', false),
  ('tocopilla', 'Tocopilla', 'Antofagasta', false),
  ('maria elena', 'María Elena', 'Antofagasta', false),
  ('copiapo', 'Copiapó', 'Atacama', false),
  ('caldera', 'Caldera', 'Atacama', false),
  ('tierra amarilla', 'Tierra Amarilla', 'Atacama', false),
  ('chanaral', 'Chañaral', 'Atacama', false),
  ('diego de almagro', 'Diego de Almagro', 'Atacama', false),
  ('vallenar', 'Vallenar', 'Atacama', false),
  ('alto del carmen', 'Alto del Carmen', 'Atacama', false),
  ('freirina', 'Freirina', 'Atacama', false),
  ('huasco', 'Huasco', 'Atacama', false),
  ('la serena', 'La Serena', 'Coquimbo', false),
  ('coquimbo', 'Coquimbo', 'Coquimbo', false),
  ('andacollo', 'Andacollo', 'Coquimbo', false),
  ('la higuera', 'La Higuera', 'Coquimbo', false),
  ('paiguano', 'Paiguano', 'Coquimbo', false),
  ('vicuna', 'Vicuña', 'Coquimbo', false),
  ('illapel', 'Illapel', 'Coquimbo', false),
  ('canela', 'Canela', 'Coquimbo', false),
  ('los vilos', 'Los Vilos', 'Coquimbo', false),
  ('salamanca', 'Salamanca', 'Coquimbo', false),
  ('ovalle', 'Ovalle', 'Coquimbo', false),
  ('combarbala', 'Combarbalá', 'Coquimbo', false),
  ('monte patria', 'Monte Patria', 'Coquimbo', false),
  ('punitaqui', 'Punitaqui', 'Coquimbo', false),
  ('rio hurtado', 'Río Hurtado', 'Coquimbo', false),
  ('valparaiso', 'Valparaíso', 'Valparaíso', false),
  ('casablanca', 'Casablanca', 'Valparaíso', false),
  ('concon', 'Concón', 'Valparaíso', false),
  ('juan fernandez', 'Juan Fernández', 'Valparaíso', false),
  ('puchuncavi', 'Puchuncaví', 'Valparaíso', false),
  ('quintero', 'Quintero', 'Valparaíso', false),
  ('vina del mar', 'Viña del Mar', 'Valparaíso', false),
  ('isla de pascua', 'Isla de Pascua', 'Valparaíso', false),
  ('los andes', 'Los Andes', 'Valparaíso', false),
  ('calle larga', 'Calle Larga', 'Valparaíso', false),
  ('rinconada', 'Rinconada', 'Valparaíso', false),
  ('san esteban', 'San Esteban', 'Valparaíso', false),
  ('la ligua', 'La Ligua', 'Valparaíso', false),
  ('cabildo', 'Cabildo', 'Valparaíso', false),
  ('papudo', 'Papudo', 'Valparaíso', false),
  ('petorca', 'Petorca', 'Valparaíso', false),
  ('zapallar', 'Zapallar', 'Valparaíso', false),
  ('quillota', 'Quillota', 'Valparaíso', false),
  ('la calera', 'La Calera', 'Valparaíso', false),
  ('hijuelas', 'Hijuelas', 'Valparaíso', false),
  ('la cruz', 'La Cruz', 'Valparaíso', false),
  ('nogales', 'Nogales', 'Valparaíso', false),
  ('san antonio', 'San Antonio', 'Valparaíso', false),
  ('algarrobo', 'Algarrobo', 'Valparaíso', false),
  ('cartagena', 'Cartagena', 'Valparaíso', false),
  ('el quisco', 'El Quisco', 'Valparaíso', false),
  ('el tabo', 'El Tabo', 'Valparaíso', false),
  ('santo domingo', 'Santo Domingo', 'Valparaíso', false),
  ('san felipe', 'San Felipe', 'Valparaíso', false),
  ('catemu', 'Catemu', 'Valparaíso', false),
  ('llaillay', 'Llaillay', 'Valparaíso', false),
  ('panquehue', 'Panquehue', 'Valparaíso', false),
  ('putaendo', 'Putaendo', 'Valparaíso', false),
  ('santa maria', 'Santa María', 'Valparaíso', false),
  ('quilpue', 'Quilpué', 'Valparaíso', false),
  ('limache', 'Limache', 'Valparaíso', false),
  ('olmue', 'Olmué', 'Valparaíso', false),
  ('villa alemana', 'Villa Alemana', 'Valparaíso', false),
  ('cerrillos', 'Cerrillos', 'Metropolitana de Santiago', false),
  ('cerro navia', 'Cerro Navia', 'Metropolitana de Santiago', false),
  ('conchali', 'Conchalí', 'Metropolitana de Santiago', false),
  ('el bosque', 'El Bosque', 'Metropolitana de Santiago', false),
  ('estacion central', 'Estación Central', 'Metropolitana de Santiago', false),
  ('huechuraba', 'Huechuraba', 'Metropolitana de Santiago', false),
  ('independencia', 'Independencia', 'Metropolitana de Santiago', false),
  ('la cisterna', 'La Cisterna', 'Metropolitana de Santiago', false),
  ('la florida', 'La Florida', 'Metropolitana de Santiago', false),
  ('la granja', 'La Granja', 'Metropolitana de Santiago', false),
  ('la pintana', 'La Pintana', 'Metropolitana de Santiago', false),
  ('la reina', 'La Reina', 'Metropolitana de Santiago', false),
  ('las condes', 'Las Condes', 'Metropolitana de Santiago', false),
  ('lo barnechea', 'Lo Barnechea', 'Metropolitana de Santiago', false),
  ('lo espejo', 'Lo Espejo', 'Metropolitana de Santiago', false),
  ('lo prado', 'Lo Prado', 'Metropolitana de Santiago', false),
  ('macul', 'Macul', 'Metropolitana de Santiago', false),
  ('maipu', 'Maipú', 'Metropolitana de Santiago', false),
  ('nunoa', 'Ñuñoa', 'Metropolitana de Santiago', false),
  ('pedro aguirre cerda', 'Pedro Aguirre Cerda', 'Metropolitana de Santiago', false),
  ('penalolen', 'Peñalolén', 'Metropolitana de Santiago', false),
  ('providencia', 'Providencia', 'Metropolitana de Santiago', false),
  ('pudahuel', 'Pudahuel', 'Metropolitana de Santiago', false),
  ('quilicura', 'Quilicura', 'Metropolitana de Santiago', false),
  ('quinta normal', 'Quinta Normal', 'Metropolitana de Santiago', false),
  ('recoleta', 'Recoleta', 'Metropolitana de Santiago', false),
  ('renca', 'Renca', 'Metropolitana de Santiago', false),
  ('san joaquin', 'San Joaquín', 'Metropolitana de Santiago', false),
  ('san miguel', 'San Miguel', 'Metropolitana de Santiago', false),
  ('san ramon', 'San Ramón', 'Metropolitana de Santiago', false),
  ('santiago', 'Santiago', 'Metropolitana de Santiago', false),
  ('vitacura', 'Vitacura', 'Metropolitana de Santiago', false),
  ('puente alto', 'Puente Alto', 'Metropolitana de Santiago', false),
  ('pirque', 'Pirque', 'Metropolitana de Santiago', false),
  ('san jose de maipo', 'San José de Maipo', 'Metropolitana de Santiago', false),
  ('colina', 'Colina', 'Metropolitana de Santiago', false),
  ('lampa', 'Lampa', 'Metropolitana de Santiago', false),
  ('tiltil', 'Tiltil', 'Metropolitana de Santiago', false),
  ('san bernardo', 'San Bernardo', 'Metropolitana de Santiago', false),
  ('buin', 'Buin', 'Metropolitana de Santiago', false),
  ('calera de tango', 'Calera de Tango', 'Metropolitana de Santiago', false),
  ('paine', 'Paine', 'Metropolitana de Santiago', false),
  ('melipilla', 'Melipilla', 'Metropolitana de Santiago', false),
  ('alhue', 'Alhué', 'Metropolitana de Santiago', false),
  ('curacavi', 'Curacaví', 'Metropolitana de Santiago', false),
  ('maria pinto', 'María Pinto', 'Metropolitana de Santiago', false),
  ('san pedro', 'San Pedro', 'Metropolitana de Santiago', false),
  ('talagante', 'Talagante', 'Metropolitana de Santiago', false),
  ('el monte', 'El Monte', 'Metropolitana de Santiago', false),
  ('isla de maipo', 'Isla de Maipo', 'Metropolitana de Santiago', false),
  ('padre hurtado', 'Padre Hurtado', 'Metropolitana de Santiago', false),
  ('penaflor', 'Peñaflor', 'Metropolitana de Santiago', false),
  ('rancagua', 'Rancagua', 'Libertador General Bernardo O''Higgins', false),
  ('codegua', 'Codegua', 'Libertador General Bernardo O''Higgins', false),
  ('coinco', 'Coinco', 'Libertador General Bernardo O''Higgins', false),
  ('coltauco', 'Coltauco', 'Libertador General Bernardo O''Higgins', false),
  ('donihue', 'Doñihue', 'Libertador General Bernardo O''Higgins', false),
  ('graneros', 'Graneros', 'Libertador General Bernardo O''Higgins', false),
  ('las cabras', 'Las Cabras', 'Libertador General Bernardo O''Higgins', false),
  ('machali', 'Machalí', 'Libertador General Bernardo O''Higgins', false),
  ('malloa', 'Malloa', 'Libertador General Bernardo O''Higgins', false),
  ('mostazal', 'Mostazal', 'Libertador General Bernardo O''Higgins', false),
  ('olivar', 'Olivar', 'Libertador General Bernardo O''Higgins', false),
  ('peumo', 'Peumo', 'Libertador General Bernardo O''Higgins', false),
  ('pichidegua', 'Pichidegua', 'Libertador General Bernardo O''Higgins', false),
  ('quinta de tilcoco', 'Quinta de Tilcoco', 'Libertador General Bernardo O''Higgins', false),
  ('rengo', 'Rengo', 'Libertador General Bernardo O''Higgins', false),
  ('requinoa', 'Requínoa', 'Libertador General Bernardo O''Higgins', false),
  ('san vicente', 'San Vicente', 'Libertador General Bernardo O''Higgins', false),
  ('pichilemu', 'Pichilemu', 'Libertador General Bernardo O''Higgins', false),
  ('la estrella', 'La Estrella', 'Libertador General Bernardo O''Higgins', false),
  ('litueche', 'Litueche', 'Libertador General Bernardo O''Higgins', false),
  ('marchihue', 'Marchihue', 'Libertador General Bernardo O''Higgins', false),
  ('navidad', 'Navidad', 'Libertador General Bernardo O''Higgins', false),
  ('paredones', 'Paredones', 'Libertador General Bernardo O''Higgins', false),
  ('san fernando', 'San Fernando', 'Libertador General Bernardo O''Higgins', false),
  ('chepica', 'Chépica', 'Libertador General Bernardo O''Higgins', false),
  ('chimbarongo', 'Chimbarongo', 'Libertador General Bernardo O''Higgins', false),
  ('lolol', 'Lolol', 'Libertador General Bernardo O''Higgins', false),
  ('nancagua', 'Nancagua', 'Libertador General Bernardo O''Higgins', false),
  ('palmilla', 'Palmilla', 'Libertador General Bernardo O''Higgins', false),
  ('peralillo', 'Peralillo', 'Libertador General Bernardo O''Higgins', false),
  ('placilla', 'Placilla', 'Libertador General Bernardo O''Higgins', false),
  ('pumanque', 'Pumanque', 'Libertador General Bernardo O''Higgins', false),
  ('santa cruz', 'Santa Cruz', 'Libertador General Bernardo O''Higgins', false),
  ('talca', 'Talca', 'Maule', false),
  ('constitucion', 'Constitución', 'Maule', false),
  ('curepto', 'Curepto', 'Maule', false),
  ('empedrado', 'Empedrado', 'Maule', false),
  ('maule', 'Maule', 'Maule', false),
  ('pelarco', 'Pelarco', 'Maule', false),
  ('pencahue', 'Pencahue', 'Maule', false),
  ('rio claro', 'Río Claro', 'Maule', false),
  ('san clemente', 'San Clemente', 'Maule', false),
  ('san rafael', 'San Rafael', 'Maule', false),
  ('cauquenes', 'Cauquenes', 'Maule', false),
  ('chanco', 'Chanco', 'Maule', false),
  ('pelluhue', 'Pelluhue', 'Maule', false),
  ('curico', 'Curicó', 'Maule', false),
  ('hualane', 'Hualañé', 'Maule', false),
  ('licanten', 'Licantén', 'Maule', false),
  ('molina', 'Molina', 'Maule', false),
  ('rauco', 'Rauco', 'Maule', false),
  ('romeral', 'Romeral', 'Maule', false),
  ('sagrada familia', 'Sagrada Familia', 'Maule', false),
  ('teno', 'Teno', 'Maule', false),
  ('vichuquen', 'Vichuquén', 'Maule', false),
  ('linares', 'Linares', 'Maule', false),
  ('colbun', 'Colbún', 'Maule', false),
  ('longavi', 'Longaví', 'Maule', false),
  ('parral', 'Parral', 'Maule', false),
  ('retiro', 'Retiro', 'Maule', false),
  ('san javier', 'San Javier', 'Maule', false),
  ('villa alegre', 'Villa Alegre', 'Maule', false),
  ('yerbas buenas', 'Yerbas Buenas', 'Maule', false),
  ('chillan', 'Chillán', 'Ñuble', false),
  ('bulnes', 'Bulnes', 'Ñuble', false),
  ('chillan viejo', 'Chillán Viejo', 'Ñuble', false),
  ('el carmen', 'El Carmen', 'Ñuble', false),
  ('pemuco', 'Pemuco', 'Ñuble', false),
  ('pinto', 'Pinto', 'Ñuble', false),
  ('quillon', 'Quillón', 'Ñuble', false),
  ('san ignacio', 'San Ignacio', 'Ñuble', false),
  ('yungay', 'Yungay', 'Ñuble', false),
  ('quirihue', 'Quirihue', 'Ñuble', false),
  ('cobquecura', 'Cobquecura', 'Ñuble', false),
  ('coelemu', 'Coelemu', 'Ñuble', false),
  ('ninhue', 'Ninhue', 'Ñuble', false),
  ('portezuelo', 'Portezuelo', 'Ñuble', false),
  ('ranquil', 'Ránquil', 'Ñuble', false),
  ('treguaco', 'Treguaco', 'Ñuble', false),
  ('san carlos', 'San Carlos', 'Ñuble', false),
  ('coihueco', 'Coihueco', 'Ñuble', false),
  ('niquen', 'Ñiquén', 'Ñuble', false),
  ('san fabian', 'San Fabián', 'Ñuble', false),
  ('san nicolas', 'San Nicolás', 'Ñuble', false),
  ('concepcion', 'Concepción', 'Biobío', false),
  ('coronel', 'Coronel', 'Biobío', false),
  ('chiguayante', 'Chiguayante', 'Biobío', false),
  ('florida', 'Florida', 'Biobío', false),
  ('hualqui', 'Hualqui', 'Biobío', false),
  ('lota', 'Lota', 'Biobío', false),
  ('penco', 'Penco', 'Biobío', false),
  ('san pedro de la paz', 'San Pedro de la Paz', 'Biobío', false),
  ('santa juana', 'Santa Juana', 'Biobío', false),
  ('talcahuano', 'Talcahuano', 'Biobío', false),
  ('tome', 'Tomé', 'Biobío', false),
  ('hualpen', 'Hualpén', 'Biobío', false),
  ('lebu', 'Lebu', 'Biobío', false),
  ('arauco', 'Arauco', 'Biobío', false),
  ('canete', 'Cañete', 'Biobío', false),
  ('contulmo', 'Contulmo', 'Biobío', false),
  ('curanilahue', 'Curanilahue', 'Biobío', false),
  ('los alamos', 'Los Álamos', 'Biobío', false),
  ('tirua', 'Tirúa', 'Biobío', false),
  ('los angeles', 'Los Ángeles', 'Biobío', false),
  ('antuco', 'Antuco', 'Biobío', false),
  ('cabrero', 'Cabrero', 'Biobío', false),
  ('laja', 'Laja', 'Biobío', false),
  ('mulchen', 'Mulchén', 'Biobío', false),
  ('nacimiento', 'Nacimiento', 'Biobío', false),
  ('negrete', 'Negrete', 'Biobío', false),
  ('quilaco', 'Quilaco', 'Biobío', false),
  ('quilleco', 'Quilleco', 'Biobío', false),
  ('san rosendo', 'San Rosendo', 'Biobío', false),
  ('santa barbara', 'Santa Bárbara', 'Biobío', false),
  ('tucapel', 'Tucapel', 'Biobío', false),
  ('yumbel', 'Yumbel', 'Biobío', false),
  ('alto biobio', 'Alto Biobío', 'Biobío', false),
  ('temuco', 'Temuco', 'La Araucanía', false),
  ('carahue', 'Carahue', 'La Araucanía', false),
  ('cunco', 'Cunco', 'La Araucanía', false),
  ('curarrehue', 'Curarrehue', 'La Araucanía', false),
  ('freire', 'Freire', 'La Araucanía', false),
  ('galvarino', 'Galvarino', 'La Araucanía', false),
  ('gorbea', 'Gorbea', 'La Araucanía', false),
  ('lautaro', 'Lautaro', 'La Araucanía', false),
  ('loncoche', 'Loncoche', 'La Araucanía', false),
  ('melipeuco', 'Melipeuco', 'La Araucanía', false),
  ('nueva imperial', 'Nueva Imperial', 'La Araucanía', false),
  ('padre las casas', 'Padre Las Casas', 'La Araucanía', false),
  ('perquenco', 'Perquenco', 'La Araucanía', false),
  ('pitrufquen', 'Pitrufquén', 'La Araucanía', false),
  ('pucon', 'Pucón', 'La Araucanía', false),
  ('saavedra', 'Saavedra', 'La Araucanía', false),
  ('teodoro schmidt', 'Teodoro Schmidt', 'La Araucanía', false),
  ('tolten', 'Toltén', 'La Araucanía', false),
  ('vilcun', 'Vilcún', 'La Araucanía', false),
  ('villarrica', 'Villarrica', 'La Araucanía', false),
  ('cholchol', 'Cholchol', 'La Araucanía', false),
  ('angol', 'Angol', 'La Araucanía', false),
  ('collipulli', 'Collipulli', 'La Araucanía', false),
  ('curacautin', 'Curacautín', 'La Araucanía', false),
  ('ercilla', 'Ercilla', 'La Araucanía', false),
  ('lonquimay', 'Lonquimay', 'La Araucanía', false),
  ('los sauces', 'Los Sauces', 'La Araucanía', false),
  ('lumaco', 'Lumaco', 'La Araucanía', false),
  ('puren', 'Purén', 'La Araucanía', false),
  ('renaico', 'Renaico', 'La Araucanía', false),
  ('traiguen', 'Traiguén', 'La Araucanía', false),
  ('victoria', 'Victoria', 'La Araucanía', false),
  ('valdivia', 'Valdivia', 'Los Ríos', false),
  ('corral', 'Corral', 'Los Ríos', false),
  ('lanco', 'Lanco', 'Los Ríos', false),
  ('los lagos', 'Los Lagos', 'Los Ríos', false),
  ('mafil', 'Máfil', 'Los Ríos', false),
  ('mariquina', 'Mariquina', 'Los Ríos', false),
  ('paillaco', 'Paillaco', 'Los Ríos', false),
  ('panguipulli', 'Panguipulli', 'Los Ríos', false),
  ('la union', 'La Unión', 'Los Ríos', false),
  ('futrono', 'Futrono', 'Los Ríos', false),
  ('lago ranco', 'Lago Ranco', 'Los Ríos', false),
  ('rio bueno', 'Río Bueno', 'Los Ríos', false),
  ('puerto montt', 'Puerto Montt', 'Los Lagos', false),
  ('calbuco', 'Calbuco', 'Los Lagos', false),
  ('cochamo', 'Cochamó', 'Los Lagos', false),
  ('fresia', 'Fresia', 'Los Lagos', false),
  ('frutillar', 'Frutillar', 'Los Lagos', false),
  ('los muermos', 'Los Muermos', 'Los Lagos', false),
  ('llanquihue', 'Llanquihue', 'Los Lagos', false),
  ('maullin', 'Maullín', 'Los Lagos', false),
  ('puerto varas', 'Puerto Varas', 'Los Lagos', false),
  ('castro', 'Castro', 'Los Lagos', false),
  ('ancud', 'Ancud', 'Los Lagos', false),
  ('chonchi', 'Chonchi', 'Los Lagos', false),
  ('curaco de velez', 'Curaco de Vélez', 'Los Lagos', false),
  ('dalcahue', 'Dalcahue', 'Los Lagos', false),
  ('puqueldon', 'Puqueldón', 'Los Lagos', false),
  ('queilen', 'Queilén', 'Los Lagos', false),
  ('quellon', 'Quellón', 'Los Lagos', false),
  ('quemchi', 'Quemchi', 'Los Lagos', false),
  ('quinchao', 'Quinchao', 'Los Lagos', false),
  ('osorno', 'Osorno', 'Los Lagos', false),
  ('puerto octay', 'Puerto Octay', 'Los Lagos', false),
  ('purranque', 'Purranque', 'Los Lagos', false),
  ('puyehue', 'Puyehue', 'Los Lagos', false),
  ('rio negro', 'Río Negro', 'Los Lagos', false),
  ('san juan de la costa', 'San Juan de la Costa', 'Los Lagos', false),
  ('san pablo', 'San Pablo', 'Los Lagos', false),
  ('chaiten', 'Chaitén', 'Los Lagos', false),
  ('futaleufu', 'Futaleufú', 'Los Lagos', false),
  ('hualaihue', 'Hualaihué', 'Los Lagos', false),
  ('palena', 'Palena', 'Los Lagos', false),
  ('coyhaique', 'Coyhaique', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('lago verde', 'Lago Verde', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('aysen', 'Aysén', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('cisnes', 'Cisnes', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('guaitecas', 'Guaitecas', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('cochrane', 'Cochrane', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('o''higgins', 'O''Higgins', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('tortel', 'Tortel', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('chile chico', 'Chile Chico', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('rio ibanez', 'Río Ibáñez', 'Aysén del General Carlos Ibáñez del Campo', false),
  ('punta arenas', 'Punta Arenas', 'Magallanes y de la Antártica Chilena', false),
  ('laguna blanca', 'Laguna Blanca', 'Magallanes y de la Antártica Chilena', false),
  ('rio verde', 'Río Verde', 'Magallanes y de la Antártica Chilena', false),
  ('san gregorio', 'San Gregorio', 'Magallanes y de la Antártica Chilena', false),
  ('cabo de hornos', 'Cabo de Hornos', 'Magallanes y de la Antártica Chilena', false),
  ('antartica', 'Antártica', 'Magallanes y de la Antártica Chilena', false),
  ('porvenir', 'Porvenir', 'Magallanes y de la Antártica Chilena', false),
  ('primavera', 'Primavera', 'Magallanes y de la Antártica Chilena', false),
  ('timaukel', 'Timaukel', 'Magallanes y de la Antártica Chilena', false),
  ('natales', 'Natales', 'Magallanes y de la Antártica Chilena', false),
  ('torres del paine', 'Torres del Paine', 'Magallanes y de la Antártica Chilena', false),
  ('santiago centro', 'Santiago', 'Metropolitana de Santiago', true);

alter table comunas_chile enable row level security;

-- Dato público: lectura para cualquier usuario autenticado. Sin escritura.
create policy comunas_chile_select on comunas_chile
  for select to authenticated
  using (true);

revoke all on comunas_chile from anon;
revoke insert, update, delete, truncate on comunas_chile from authenticated;


-- ------------------------------------------------------------
-- 2) Quién puede ver y operar producción
-- ------------------------------------------------------------
-- security definer + search_path fijo, igual que rol_actual() (0002):
-- consulta "usuarios" sin quedar atrapada en sus propias políticas de RLS.
create or replace function public.tiene_acceso_produccion()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(rol_actual() in ('administrador', 'bodega'), false);
$$;

revoke execute on function public.tiene_acceso_produccion() from public, anon;
grant execute on function public.tiene_acceso_produccion() to authenticated;


-- ------------------------------------------------------------
-- 3) ordenes_fabricacion
-- ------------------------------------------------------------
-- Las columnas de texto (tipo, modelo, cm, color...) NO son enums: los
-- valores vienen de Shopify y son variados (por ejemplo cm puede ser
-- "170 cm", "ESTÁNDAR" o "215 cm x 150 cm"). Se guardan tal cual los
-- normaliza la sincronización.
create table ordenes_fabricacion (
  id uuid primary key default gen_random_uuid(),

  -- Identidad. "numero" es lo que se ve en la planilla: el número del
  -- pedido, o número-1, número-2... si el pedido trae varios muebles.
  numero text not null,
  pedido_numero text not null,
  shopify_order_id text not null,
  shopify_line_item_id text not null,
  -- Índice de la unidad dentro de su línea (1, 2, ...): una línea con
  -- cantidad 3 genera 3 filas con unidad 1, 2 y 3.
  unidad integer not null default 1 check (unidad >= 1),

  -- Datos del mueble (vienen de Shopify; la sincronización los puede
  -- volver a escribir, las etapas y el estado NO).
  tipo text,
  modelo text,
  orientacion text,
  cm text,
  color text,
  tela text,
  region text,
  comuna text,
  patas text not null default 'PREDETERMINADAS',
  -- Momento exacto en que se hizo el pedido en Shopify. La sincronización
  -- escribe solo este; fecha_pedido (día, hora de Chile) la calcula el
  -- trigger de más abajo, para filtrar por rango de fechas.
  pedido_creado_en timestamptz not null,
  fecha_pedido date not null,
  -- Título original de la línea en Shopify: sirve para entender los casos
  -- raros (adicionales, cojines, etc.) sin volver a consultar Shopify.
  titulo_shopify text,

  -- Las calcula el trigger de normalización (no las escribe la sincronización).
  -- es_adicional: la línea no es un mueble (patas extra, cojines, "10 cm
  -- adicional respaldo"...). Se importa igual, como en la planilla.
  es_adicional boolean not null default false,
  -- comuna_revisar: la comuna no está en la lista oficial (¿error de tipeo?).
  comuna_revisar boolean not null default false,
  -- Notas de la nota del pedido SIN RUT, teléfonos ni correos. La calcula
  -- un trigger de ordenes_fabricacion_cliente a partir del texto completo
  -- (que vive solo en esa tabla). Es lo único de la nota que se muestra en
  -- el listado y se imprime en la hoja de fabricación.
  notas_produccion text,

  -- Etapas de fabricación (cada una es solo un check).
  etapa_b boolean not null default false,
  etapa_i boolean not null default false,
  etapa_a boolean not null default false,
  etapa_c boolean not null default false,
  listo boolean not null default false,
  listo_en timestamptz,

  estado estado_orden_fabricacion not null default 'por_fabricar',

  -- Si el pedido se cancela en Shopify después de importado, no se borra:
  -- se marca y deja de mostrarse.
  cancelado_en timestamptz,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  -- Idempotencia: la misma línea y unidad nunca se inserta dos veces.
  constraint ordenes_fabricacion_unidad_unica unique (shopify_line_item_id, unidad),

  -- LISTO y el estado van siempre juntos: "por fabricar" significa no
  -- listo, y cualquier estado posterior significa listo.
  constraint ordenes_fabricacion_listo_coherente
    check ((estado = 'por_fabricar') = (not listo))
);

create index ordenes_fabricacion_fecha_idx on ordenes_fabricacion (fecha_pedido desc);
create index ordenes_fabricacion_estado_idx on ordenes_fabricacion (estado) where cancelado_en is null;
create index ordenes_fabricacion_comuna_idx on ordenes_fabricacion (comuna);
create index ordenes_fabricacion_modelo_idx on ordenes_fabricacion (modelo);
create index ordenes_fabricacion_tela_idx on ordenes_fabricacion (tela);
create index ordenes_fabricacion_pedido_idx on ordenes_fabricacion (pedido_numero);


-- Normalización al insertar o al cambiar los campos de Shopify. Los
-- UPDATE de marcar_etapa / avanzar_estado_orden no tocan estas columnas,
-- así que no la disparan.
-- security definer: lee comunas_chile sin depender de los permisos de
-- quien escribe (la Edge Function usa la clave de servicio, pero así
-- también funciona desde el SQL Editor o cualquier otro rol).
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

  return new;
end;
$$;

create trigger ordenes_fabricacion_normalizar
  before insert or update of tipo, color, region, comuna, pedido_creado_en
  on ordenes_fabricacion
  for each row execute function normalizar_orden_fabricacion();


-- ------------------------------------------------------------
-- 4) ordenes_fabricacion_cliente (datos personales)
-- ------------------------------------------------------------
create table ordenes_fabricacion_cliente (
  orden_id uuid primary key references ordenes_fabricacion(id) on delete cascade,
  cliente text,
  -- "Inf adicional" de la planilla: aquí vienen RUT, teléfono y correo.
  inf_adicional text,
  direccion text,
  actualizado_en timestamptz not null default now()
);

-- Cada vez que se guarda o cambia la nota completa, se recalcula la versión
-- sin datos personales en la orden. Lo hace la base de datos para que no
-- dependa de que la sincronización se acuerde de hacerlo.
create or replace function public.sincronizar_notas_produccion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update ordenes_fabricacion
  set notas_produccion = notas_sin_datos_personales(new.inf_adicional)
  where id = new.orden_id;
  return null;
end;
$$;

create trigger ordenes_fabricacion_cliente_notas
  after insert or update of inf_adicional on ordenes_fabricacion_cliente
  for each row execute function sincronizar_notas_produccion();


-- ------------------------------------------------------------
-- 5) sync_shopify (una sola fila)
-- ------------------------------------------------------------
create table sync_shopify (
  id boolean primary key default true check (id),
  -- No se importan pedidos anteriores a esta fecha.
  importar_desde date not null default date '2026-10-01',
  -- Hasta dónde llegó la última sincronización exitosa (la función
  -- vuelve a pedir desde aquí menos un pequeño solape).
  ultima_sincronizacion timestamptz,
  ultimo_intento timestamptz,
  ultimo_error text,
  ordenes_ultima_corrida integer
);

insert into sync_shopify (id) values (true);


-- ------------------------------------------------------------
-- 6) RLS
-- ------------------------------------------------------------
alter table ordenes_fabricacion enable row level security;
alter table ordenes_fabricacion_cliente enable row level security;
alter table sync_shopify enable row level security;

-- Solo lectura desde la app. No hay políticas de INSERT/UPDATE/DELETE:
-- con RLS activo eso las deniega. Escriben la Edge Function (clave de
-- servicio) y las funciones de abajo (security definer).
create policy ordenes_fabricacion_select on ordenes_fabricacion
  for select to authenticated
  using (tiene_acceso_produccion());

create policy ordenes_fabricacion_cliente_select on ordenes_fabricacion_cliente
  for select to authenticated
  using (tiene_acceso_produccion());

-- El estado de la sincronización lo ve solo el administrador.
create policy sync_shopify_select on sync_shopify
  for select to authenticated
  using (rol_actual() = 'administrador');

-- Sin acceso anónimo y sin escritura directa, por si algún día se
-- agregara una política por error.
revoke all on ordenes_fabricacion, ordenes_fabricacion_cliente, sync_shopify from anon;
revoke insert, update, delete, truncate on ordenes_fabricacion, ordenes_fabricacion_cliente, sync_shopify from authenticated;


-- ------------------------------------------------------------
-- 7) marcar_etapa: marcar o desmarcar B, I, A, C o LISTO
-- ------------------------------------------------------------
-- p_etapa: 'b' | 'i' | 'a' | 'c' | 'listo'.
--   - B, I, A, C se pueden cambiar mientras la orden no salió a despacho.
--   - LISTO se marca a mano. Al marcarlo, el estado pasa a "fabricado".
--     Al desmarcarlo (solo si sigue "fabricado") vuelve a "por fabricar".
--   - Una orden en despacho o entregada ya no se toca desde acá.
create or replace function public.marcar_etapa(
  p_orden_id uuid,
  p_etapa text,
  p_valor boolean
)
returns ordenes_fabricacion
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orden ordenes_fabricacion;
begin
  if not tiene_acceso_produccion() then
    raise exception 'No tienes permiso para modificar órdenes de fabricación.'
      using errcode = '42501';
  end if;

  if p_etapa is null or p_etapa not in ('b', 'i', 'a', 'c', 'listo') then
    raise exception 'Etapa inválida: %. Usa b, i, a, c o listo.', p_etapa
      using errcode = '22023';
  end if;

  if p_valor is null then
    raise exception 'Indica si la etapa queda marcada o no.'
      using errcode = '22023';
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

  if v_orden.estado in ('en_despacho', 'entregado') then
    raise exception 'La orden % ya está en despacho o entregada: no se pueden cambiar sus etapas.', v_orden.numero
      using errcode = 'P0001';
  end if;

  if p_etapa = 'listo' then
    update ordenes_fabricacion
    set listo = p_valor,
        listo_en = case when p_valor then now() else null end,
        estado = case when p_valor then 'fabricado'::estado_orden_fabricacion
                      else 'por_fabricar'::estado_orden_fabricacion end,
        actualizado_en = now()
    where id = p_orden_id
    returning * into v_orden;
  else
    update ordenes_fabricacion
    set etapa_b = case when p_etapa = 'b' then p_valor else etapa_b end,
        etapa_i = case when p_etapa = 'i' then p_valor else etapa_i end,
        etapa_a = case when p_etapa = 'a' then p_valor else etapa_a end,
        etapa_c = case when p_etapa = 'c' then p_valor else etapa_c end,
        actualizado_en = now()
    where id = p_orden_id
    returning * into v_orden;
  end if;

  return v_orden;
end;
$$;

revoke execute on function public.marcar_etapa(uuid, text, boolean) from public, anon;
grant execute on function public.marcar_etapa(uuid, text, boolean) to authenticated;


-- ------------------------------------------------------------
-- 8) avanzar_estado_orden: fabricado -> en_despacho -> entregado
-- ------------------------------------------------------------
-- "por fabricar" no avanza por acá: sale de ese estado marcando LISTO.
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
      actualizado_en = now()
  where id = p_orden_id;

  return v_siguiente;
end;
$$;

revoke execute on function public.avanzar_estado_orden(uuid) from public, anon;
grant execute on function public.avanzar_estado_orden(uuid) to authenticated;
