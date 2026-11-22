/* Inventario de telas (migración 0019) en el Supabase falso: las mismas reglas y mensajes que la tabla y la función
   reales. Solo el administrador ve las filas (RLS); ajustar_tela valida el rol y que los números no sean negativos.
   Las telas se recuerdan en localStorage['test-telas'] para sobrevivir a una recarga; la prueba puede sembrarlas ahí.
   Este texto lo inserta armar.mjs en preview-tmp/supabaseFalso.ts; no se compila por separado. */
const TELAS_INICIALES = ['Lino', 'Cuero', 'Semicuero', 'Tela hidrorepelente'].map((nombre, i) => ({ id: `tela-${i + 1}`, numero: nombre, nombre, metros: 100, stock_minimo: 30 }))
const telas: Fila[] = JSON.parse(localStorage.getItem('test-telas') ?? 'null') ?? TELAS_INICIALES
const persistirTelas = () => localStorage.setItem('test-telas', JSON.stringify(telas))
;(window as unknown as { __srv: Record<string, unknown> }).__srv.telas = () => telas.map((t) => ({ ...t }))

function ajustarTelaFalso(a: Record<string, unknown>) {
  bitacora('ajustar_tela', a)
  if (rol() !== 'administrador') return falla('Solo el administrador puede ajustar el inventario de telas.')
  const metros = a.p_metros as number | null
  const minimo = a.p_stock_minimo as number | null
  if (metros == null || minimo == null || metros < 0 || minimo < 0) return falla('Los metros y el mínimo deben ser números de 0 o más.')
  const tela = telas.find((t) => t.id === a.p_tela_id)
  if (!tela) return falla('La tela indicada no existe.')
  tela.metros = Math.round(metros * 100) / 100
  tela.stock_minimo = Math.round(minimo * 100) / 100
  persistirTelas()
  return { data: null, error: null }
}
