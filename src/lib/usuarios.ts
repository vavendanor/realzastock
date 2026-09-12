import type { Usuario, UserRole } from '../types'
import { supabase } from './supabaseClient'

export const ROL_LABEL: Record<UserRole, string> = {
  administrador: 'Administrador',
  vendedor: 'Vendedor',
  bodega: 'Bodega',
}

export const ROLES: UserRole[] = ['administrador', 'vendedor', 'bodega']

interface UsuarioRaw {
  id: string
  nombre: string
  email: string
  rol: UserRole
  creado_en: string
}

function aplanar(raw: UsuarioRaw): Usuario {
  return { id: raw.id, nombre: raw.nombre, email: raw.email, rol: raw.rol, creadoEn: raw.creado_en }
}

/* RLS (política `usuarios_select`, migración 0002) es lo que realmente
   protege esto: solo un administrador puede leer filas que no sean la
   propia. Un vendedor o bodega que llame a esta misma función solo se
   vería a sí mismo. */
export async function listarUsuarios(): Promise<Usuario[]> {
  const { data, error } = await supabase.from('usuarios').select('id, nombre, email, rol, creado_en').order('creado_en')

  if (error) throw new Error(error.message)
  return (data as UsuarioRaw[]).map(aplanar)
}

/* También cubierto por RLS (`usuarios_update_admin`): si alguien sin rol
   administrador llamara a esto igual, Postgres lo rechazaría solo. Esta
   función no valida el rol de quien llama porque no hace falta duplicar
   una regla que la base de datos ya impone. */
export async function actualizarRolUsuario(id: string, rol: UserRole): Promise<void> {
  const { error } = await supabase.from('usuarios').update({ rol }).eq('id', id)
  if (error) throw new Error(error.message)
}

export interface DatosNuevoUsuario {
  nombre: string
  email: string
  password: string
  rol: UserRole
}

/* Llama a la Edge Function `crear-usuario` (supabase/functions/crear-usuario)
   porque crear una cuenta de Auth para otra persona exige la service_role
   key, que nunca debe llegar al navegador. La función verifica ella misma
   que quien llama sea administrador -- ver el comentario al inicio de su
   código para el porqué completo. */
export async function crearUsuario(datos: DatosNuevoUsuario): Promise<void> {
  const { data, error } = await supabase.functions.invoke('crear-usuario', { body: datos })

  if (error) {
    /* Cuando la función responde con un código de error HTTP (400/401/403),
       el SDK lo envuelve en un FunctionsHttpError genérico y el mensaje real
       queda en el cuerpo de la respuesta, no en `error.message`. Hay que
       leerlo del contexto para no mostrar un mensaje inútil al usuario. */
    const contexto = (error as { context?: Response }).context
    if (contexto) {
      try {
        const cuerpo = await contexto.json()
        throw new Error(cuerpo.error ?? error.message)
      } catch {
        // El cuerpo no era JSON (ej. la función ni siquiera está desplegada
        // todavía): se cae al mensaje genérico del SDK.
      }
    }
    throw new Error(error.message)
  }

  if (data?.error) throw new Error(data.error)
}
