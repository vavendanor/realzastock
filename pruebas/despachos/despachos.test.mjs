/* Lógica pura de src/lib/despachos.ts: destinos, grupos por comuna, por fecha, despachos parciales.
   Correr desde la raíz:  node --import ./pruebas/registrar-ts.mjs pruebas/despachos/despachos.test.mjs */
const Dp = await import(new URL('../../src/lib/despachos.ts', import.meta.url).href)
const O = await import(new URL('../../src/lib/ordenes.ts', import.meta.url).href)

let ok = 0, fallos = 0
const chequeo = (n, c, d = '') => { c ? (ok++, console.log('  OK   ', n)) : (fallos++, console.log('  FALLA', n, d)) }
const sec = (t) => console.log(`\n== ${t}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let n = 0
const orden = (o) => O.aplanarOrden({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, numero: '1000', pedido_numero: '1000', shopify_order_id: 'gid://x/1', tipo: 'SOFÁ', modelo: 'OSORNO', orientacion: 'ninguna', cm: '170 cm', color: 'CRUDO', tela: 'LINO HIDROREPELENTE',
  region: 'Metropolitana de Santiago', comuna: 'Ñuñoa', comuna_revisar: false, patas: 'PREDETERMINADAS', fecha_pedido: '2026-10-20', plazo_desde: null, titulo_shopify: null, es_adicional: false, etapa_b: false, etapa_i: false, etapa_a: false, etapa_c: false,
  listo: true, listo_en: null, estado: 'fabricado', cancelado_en: null, notas_produccion: null, origen: 'manual_shopify', origen_shopify: 'pos', despachado_en: null, actualizado_en: '2026-10-20T00:00:00Z', pedido_creado_en: '2026-10-20T15:00:00Z', shopify_preparado: false, listo_origen: 'app', ...o,
})

sec('Destino de cada mueble')
chequeo('una comuna normal es una ruta', Dp.destinoDe('Ñuñoa') === 'ruta' && Dp.destinoDe('las condes') === 'ruta')
chequeo('RETIRO TIENDA es retiro (en cualquier escritura)', Dp.destinoDe('RETIRO TIENDA') === 'retiro' && Dp.destinoDe('Retiro tienda') === 'retiro')
chequeo('sin comuna, vacía o "NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO": sin dirección', ['', '  ', null, 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO'].every((c) => Dp.destinoDe(c) === 'sin_direccion'))

sec('Qué espera entrega')
chequeo('fabricado, no cancelado, mueble o cojín: sí', Dp.esDespachable(orden({})) && Dp.esDespachable(orden({ tipo: 'COJÍN', es_adicional: true })))
chequeo('por fabricar, en despacho, entregado, cancelado o adicional que no es cojín: no', [orden({ estado: 'por_fabricar' }), orden({ estado: 'en_despacho' }), orden({ estado: 'entregado' }), orden({ cancelado_en: '2026-10-25T00:00:00Z' }), orden({ tipo: null, es_adicional: true })].every((o) => !Dp.esDespachable(o)))
chequeo('salen a despacho: en despacho y entregado, no cancelados', Dp.salenADespacho(orden({ estado: 'en_despacho' })) && Dp.salenADespacho(orden({ estado: 'entregado' })) && !Dp.salenADespacho(orden({ estado: 'fabricado' })) && !Dp.salenADespacho(orden({ estado: 'en_despacho', cancelado_en: '2026-10-25T00:00:00Z' })))
const o1 = orden({ numero: '1000-2', estado: 'en_despacho' })
chequeo('los muebles del comprobante: solo los que salieron, ordenados por número', eq(Dp.mueblesDeDespacho(o1, [orden({ numero: '1000-10', estado: 'entregado' }), orden({ numero: '1000-1', estado: 'fabricado' }), orden({ numero: '1000-3', estado: 'en_despacho', cancelado_en: '2026-10-25T00:00:00Z' })]).map((o) => o.numero), ['1000-2', '1000-10']))

sec('Grupos: rutas por comuna, sin dirección y retiros')
const muebles = [
  orden({ numero: '1204', pedido_numero: '1204', comuna: 'Providencia' }),
  orden({ numero: '1200-2', pedido_numero: '1200', comuna: 'Providencia' }),
  orden({ numero: '1200-1', pedido_numero: '1200', comuna: 'Providencia' }),
  orden({ numero: '1210', pedido_numero: '1210', comuna: 'Ñuñoa' }),
  orden({ numero: '1211', pedido_numero: '1211', comuna: 'Las Condes' }),
  orden({ numero: '1212', pedido_numero: '1212', comuna: 'RETIRO TIENDA' }),
  orden({ numero: '1213', pedido_numero: '1213', comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO' }),
  orden({ numero: '1214', pedido_numero: '1214', comuna: null }),
  orden({ numero: '1215', pedido_numero: '1215', comuna: 'Maipú', cancelado_en: '2026-10-25T00:00:00Z' }), // cancelado
  orden({ numero: '1216', pedido_numero: '1216', comuna: 'Maipú', estado: 'por_fabricar' }), // aún no
  orden({ numero: '1217', pedido_numero: '1217', comuna: 'Vitacura', estado: 'en_despacho' }), // ya salió
  orden({ numero: '1218', pedido_numero: '1218', comuna: 'Maipú', tipo: null, es_adicional: true }), // patas
]
const g = Dp.agruparPorDestino(muebles)
chequeo('rutas por comuna en orden alfabético del español (la Ñ va entre la N y la O): Las Condes, Ñuñoa, Providencia', eq(g.rutas.map((x) => x.nombre), ['Las Condes', 'Ñuñoa', 'Providencia']), g.rutas.map((x) => x.nombre).join())
chequeo('dentro de una comuna: por pedido y unidad (1200-1, 1200-2, 1204)', eq(g.rutas.find((x) => x.nombre === 'Providencia').muebles.map((o) => o.numero), ['1200-1', '1200-2', '1204']))
chequeo('"Sin dirección" junta los sin comuna y los "NO SE PROPORCIONÓ..." (1213, 1214)', eq(g.sinDireccion.map((o) => o.numero), ['1213', '1214']))
chequeo('los retiros van aparte y no salen en ninguna ruta (1212)', eq(g.retiros.map((o) => o.numero), ['1212']) && !g.rutas.some((r) => r.muebles.some((o) => o.numero === '1212')))
chequeo('no aparecen los cancelados, los por fabricar, los que ya salieron ni las patas', ![...g.rutas.flatMap((r) => r.muebles), ...g.sinDireccion, ...g.retiros].some((o) => ['1215', '1216', '1217', '1218'].includes(o.numero)))
chequeo('la misma comuna escrita distinto va en un solo grupo', Dp.agruparPorDestino([orden({ comuna: 'Las Condes' }), orden({ comuna: 'las condes ' })]).rutas.length === 1)

sec('Por fecha')
const hoy = '2026-11-17'
const conFecha = [
  orden({ numero: '1', despacho_programado: '2026-11-19', comuna: 'Maipú' }),
  orden({ numero: '2', despacho_programado: '2026-11-18', comuna: 'Providencia' }),
  orden({ numero: '3', despacho_programado: '2026-11-18', comuna: 'Maipú' }),
  orden({ numero: '4', despacho_programado: '2026-11-18', estado: 'en_despacho', comuna: 'Ñuñoa' }),
  orden({ numero: '5', despacho_programado: '2026-11-16', comuna: 'Ñuñoa' }), // atrasado
  orden({ numero: '6', despacho_programado: '2026-11-18', cancelado_en: '2026-11-17T10:00:00Z' }), // cancelado
  orden({ numero: '7', despacho_programado: '2026-11-18', estado: 'entregado' }), // ya entregado: no se muestra
  orden({ numero: '8', despacho_programado: '2026-11-18', estado: 'por_fabricar' }), // volvió a por fabricar
  orden({ numero: '9' }), // sin fecha
]
const f = Dp.agruparPorFecha(conFecha)
chequeo('un grupo por día, el más próximo primero (16, 18, 19)', eq(f.map((x) => x.fecha), ['2026-11-16', '2026-11-18', '2026-11-19']))
const d18 = f.find((x) => x.fecha === '2026-11-18')
chequeo('el 18: por salir 3 y 2 (Maipú, Providencia por comuna), ya salió el 4', eq(d18.porSalir.map((o) => o.numero), ['3', '2']) && eq(d18.salidos.map((o) => o.numero), ['4']), JSON.stringify([d18.porSalir.map((o) => o.numero), d18.salidos.map((o) => o.numero)]))
chequeo('no salen los cancelados, entregados, por fabricar ni los sin fecha', !f.some((x) => [...x.porSalir, ...x.salidos].some((o) => ['6', '7', '8', '9'].includes(o.numero))))

sec('Despachos parciales')
const pedido = [
  orden({ numero: '1300-1', pedido_numero: '1300', estado: 'fabricado' }),
  orden({ numero: '1300-2', pedido_numero: '1300', estado: 'por_fabricar' }),
  orden({ numero: '1301-1', pedido_numero: '1301', estado: 'en_despacho' }),
  orden({ numero: '1301-2', pedido_numero: '1301', estado: 'fabricado' }),
  orden({ numero: '1302-1', pedido_numero: '1302', estado: 'fabricado' }),
  orden({ numero: '1302-2', pedido_numero: '1302', estado: 'fabricado' }),
  orden({ numero: '1303', pedido_numero: '1303', estado: 'fabricado' }),
  orden({ numero: '1304-1', pedido_numero: '1304', estado: 'fabricado' }),
  orden({ numero: '1304-2', pedido_numero: '1304', estado: 'fabricado', cancelado_en: '2026-11-01T00:00:00Z' }),
  orden({ numero: '1304-3', pedido_numero: '1304', tipo: null, es_adicional: true, estado: 'por_fabricar' }),
]
const partes = Dp.partesDePedidos(pedido)
chequeo('1300: 2 muebles, 1 listo; 1301: 2 muebles, 2 listos, 1 salió; 1304: cuenta solo el mueble activo', eq(partes.get('1300'), { muebles: 2, listos: 1, salieron: 0 }) && eq(partes.get('1301'), { muebles: 2, listos: 2, salieron: 1 }) && eq(partes.get('1304'), { muebles: 1, listos: 1, salieron: 0 }))
chequeo('avisos: "Pedido en partes: 1 por fabricar" (1300)', Dp.textoDePartes(partes.get('1300')) === 'Pedido en partes: 1 por fabricar')
chequeo('avisos: "Pedido en partes: 1 de 2 ya salieron" (1301)', Dp.textoDePartes(partes.get('1301')) === 'Pedido en partes: 1 de 2 ya salieron')
chequeo('sin aviso si el pedido va completo y junto (1302), es de un mueble (1303, 1304) o no se conoce', [partes.get('1302'), partes.get('1303'), partes.get('1304'), undefined].every((x) => Dp.textoDePartes(x) === null))

sec('Fechas en palabras')
chequeo('"2026-11-17" -> "Martes 17-11-2026" y sin corrimientos de día', Dp.etiquetaDeFecha('2026-11-17') === 'Martes 17-11-2026' && Dp.etiquetaDeFecha('2026-11-01') === 'Domingo 01-11-2026' && Dp.etiquetaDeFecha('2027-01-01') === 'Viernes 01-01-2027')
void hoy

console.log(`\n${ok} comprobaciones OK, ${fallos} fallas`)
process.exit(fallos ? 1 : 0)
