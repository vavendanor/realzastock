/* Deja que Node (con "type stripping") importe los .ts de src/ sin extensión, igual que Vite, y cambia el
   cliente de Supabase por uno vacío: las pruebas de lógica pura no tocan la base de datos. */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VACIO = new URL('./supabase-vacio.mjs', import.meta.url).href

export async function resolve(specifier, context, siguiente) {
  if (/\/supabaseClient$/.test(specifier)) return { url: VACIO, shortCircuit: true }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const base = new URL(specifier, context.parentURL).href
    for (const sufijo of ['.ts', '.tsx', '/index.ts']) {
      if (existsSync(fileURLToPath(base + sufijo))) return { url: pathToFileURL(fileURLToPath(base + sufijo)).href, shortCircuit: true }
    }
  }
  return siguiente(specifier, context)
}
