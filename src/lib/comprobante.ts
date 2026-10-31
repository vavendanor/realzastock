/* Abre el diálogo de impresión del navegador, donde se elige "Guardar como
   PDF". Chrome y Edge usan el título de la pestaña como nombre de archivo
   sugerido, así que se cambia un momento y se restaura al terminar (el
   evento `afterprint` cubre también a los navegadores donde `print()` no
   bloquea hasta que se cierra el diálogo). */
export function imprimirConTitulo(titulo: string) {
  const anterior = document.title
  document.title = titulo
  window.addEventListener(
    'afterprint',
    () => {
      document.title = anterior
    },
    { once: true },
  )
  window.print()
}
