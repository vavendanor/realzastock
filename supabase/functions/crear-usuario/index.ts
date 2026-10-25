// ============================================================
// Edge Function: crear-usuario
// ============================================================
// Por qué existe esta función (no un supabase.rpc() de PostgreSQL,
// como el resto del proyecto): crear una cuenta de Auth para OTRA
// persona requiere la API de administración de Supabase Auth
// (`auth.admin.createUser`), que solo funciona con la clave
// `service_role`. Esa clave se salta RLS por completo y JAMÁS debe
// llegar al navegador — si viviera en el bundle de React, cualquiera
// con las herramientas de desarrollador la vería y tendría acceso
// total a la base de datos. Una Edge Function corre en el servidor
// de Supabase, no en el navegador: la clave queda ahí, nunca viaja
// al cliente.
//
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los
// inyecta Supabase automáticamente en el entorno de toda Edge Function
// — no hay que configurar ningún secreto a mano para que esto funcione.
//
// Flujo:
//   1) Verifica que quien llama esté autenticado y sea administrador
//      (usando SU token, no la service_role, para esa verificación).
//   2) Si es admin, usa la service_role para crear el usuario en Auth.
//      Esto dispara el trigger on_auth_user_created (migración 0002),
//      que crea la fila espejo en "usuarios" con rol 'vendedor'.
//   3) Si el rol pedido no es 'vendedor', lo actualiza con la misma
//      service_role (que sí puede saltarse la política de RLS que
//      reserva ese UPDATE a un administrador -- acá el "administrador"
//      ya se verificó en el paso 1).
//
// Cómo desplegar esta función: ver el comentario al final del archivo.
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

/* Solo la app puede llamar a esta función desde un navegador: producción,
   las URLs de preview de Vercel y el servidor de desarrollo local. Con
   '*' cualquier sitio podría intentarlo usando la sesión de un admin. */
const ORIGENES_PERMITIDOS = [
  /^https:\/\/realzastock\.vercel\.app$/,
  /^https:\/\/realzastock-[a-z0-9-]+\.vercel\.app$/,
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/,
]

function corsPara(req: Request): Record<string, string> {
  const origen = req.headers.get('Origin') ?? ''
  const permitido = ORIGENES_PERMITIDOS.some((patron) => patron.test(origen))
  return {
    'Access-Control-Allow-Origin': permitido ? origen : 'https://realzastock.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
}

interface Payload {
  email: string
  password: string
  nombre: string
  rol: 'administrador' | 'vendedor' | 'bodega'
}

Deno.serve(async (req) => {
  const cors = corsPara(req)

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // ------------------------------------------------------------
    // 1) ¿Quién llama, y es administrador?
    // ------------------------------------------------------------
    const authHeader = req.headers.get('Authorization')
    const token = authHeader?.replace(/^Bearer\s+/i, '')
    if (!token) {
      return jsonResponse({ error: 'Falta el encabezado de autenticación.' }, 401)
    }

    // Este cliente usa la clave PÚBLICA más el token de quien llama, así
    // que tiene exactamente los permisos de esa persona y respeta RLS:
    // solo puede leer su propia fila en "usuarios". La service_role se
    // usa recién en el paso 3, después de confirmar que es admin.
    const clienteDelSolicitante = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })

    // Se valida el token explícitamente contra Supabase Auth (no basta
    // con que "parezca" un JWT): si está vencido o es falso, falla acá.
    const {
      data: { user: solicitante },
      error: errorAuth,
    } = await clienteDelSolicitante.auth.getUser(token)

    if (errorAuth || !solicitante) {
      return jsonResponse({ error: 'Sesión inválida o expirada.' }, 401)
    }

    const { data: filaSolicitante, error: errorRol } = await clienteDelSolicitante
      .from('usuarios')
      .select('rol')
      .eq('id', solicitante.id)
      .single()

    if (errorRol || filaSolicitante?.rol !== 'administrador') {
      return jsonResponse({ error: 'Solo un administrador puede crear usuarios.' }, 403)
    }

    // ------------------------------------------------------------
    // 2) Validar el cuerpo de la petición
    // ------------------------------------------------------------
    const payload = (await req.json()) as Partial<Payload>
    const { email, password, nombre, rol } = payload

    if (!email || !password || !nombre || !rol) {
      return jsonResponse({ error: 'Faltan datos: email, password, nombre y rol son obligatorios.' }, 400)
    }

    if (password.length < 8) {
      return jsonResponse({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400)
    }

    if (!['administrador', 'vendedor', 'bodega'].includes(rol)) {
      return jsonResponse({ error: 'Rol inválido.' }, 400)
    }

    // ------------------------------------------------------------
    // 3) Crear la cuenta con la service_role (esto sí se salta RLS,
    //    a propósito, porque ya verificamos el permiso en el paso 1)
    // ------------------------------------------------------------
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

    const { data: creado, error: errorCrear } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // sin esto quedaría "sin confirmar" y no podría loguearse
      user_metadata: { nombre },
    })

    if (errorCrear || !creado.user) {
      return jsonResponse({ error: errorCrear?.message ?? 'No se pudo crear el usuario.' }, 400)
    }

    // El trigger on_auth_user_created ya creó la fila en "usuarios"
    // con rol 'vendedor' por defecto. Si el admin pidió otro rol,
    // se corrige acá.
    if (rol !== 'vendedor') {
      const { error: errorActualizarRol } = await admin.from('usuarios').update({ rol }).eq('id', creado.user.id)

      if (errorActualizarRol) {
        return jsonResponse(
          {
            error: `El usuario se creó, pero no se pudo asignar el rol "${rol}": ${errorActualizarRol.message}. Cámbialo manualmente desde la pantalla de Usuarios.`,
          },
          207, // creado, pero con un problema parcial
        )
      }
    }

    return jsonResponse({ id: creado.user.id, email: creado.user.email, rol })
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Error inesperado.' }, 500)
  }
})

// ============================================================
// Cómo desplegar esta función (elige una opción):
//
// Opción A — Dashboard de Supabase (recomendada, sin instalar nada):
//   1. Ve a tu proyecto en supabase.com/dashboard -> Edge Functions.
//   2. "Deploy a new function" -> nómbrala exactamente "crear-usuario".
//   3. Pega el contenido de este archivo (sin este bloque de
//      comentarios final, aunque tampoco molesta si lo dejas).
//   4. Deploy. SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya están
//      disponibles automáticamente, no hay que configurar nada más.
//
// Opción B — CLI de Supabase (si prefieres tenerla versionada así):
//   npx supabase login
//   npx supabase link --project-ref hqtgyumuljtzrxrxskao
//   npx supabase functions deploy crear-usuario
//   (login y link son interactivos / piden credenciales tuyas, por
//   eso no los ejecuté yo mismo).
// ============================================================
