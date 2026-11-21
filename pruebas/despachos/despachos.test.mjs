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
chequeo('rutas por comuna en orden alfabético del español (la Ñ va entre la N y la O): Las Condes, Ñuñoa, Providencia', eq(g.regiones[0].comunas.map((x) => x.nombre), ['Las Condes', 'Ñuñoa', 'Providencia']), g.regiones[0].comunas.map((x) => x.nombre).join())
chequeo('dentro de una comuna: por pedido y unidad (1200-1, 1200-2, 1204)', eq(g.regiones[0].comunas.find((x) => x.nombre === 'Providencia').muebles.map((o) => o.numero), ['1200-1', '1200-2', '1204']))
chequeo('"Sin dirección" junta los sin comuna y los "NO SE PROPORCIONÓ..." (1213, 1214)', eq(g.sinDireccion.map((o) => o.numero), ['1213', '1214']))
chequeo('los retiros van aparte y no salen en ninguna ruta (1212)', eq(g.retiros.map((o) => o.numero), ['1212']) && !g.regiones.some((r) => r.comunas.some((c) => c.muebles.some((o) => o.numero === '1212'))))
chequeo('no aparecen los cancelados, los por fabricar, los que ya salieron ni las patas', ![...g.regiones.flatMap((r) => r.comunas.flatMap((c) => c.muebles)), ...g.sinDireccion, ...g.retiros].some((o) => ['1215', '1216', '1217', '1218'].includes(o.numero)))
chequeo('la misma comuna escrita distinto va en un solo grupo', Dp.agruparPorDestino([orden({ comuna: 'Las Condes' }), orden({ comuna: 'las condes ' })]).regiones[0].comunas.length === 1)

sec('Orden: región, comuna y antigüedad')
const RM = 'Metropolitana de Santiago'
const dest = (extra) => orden({ comuna: 'Providencia', region: RM, ...extra })
const surtido = [
  dest({ numero: '2001', pedido_numero: '2001', comuna: 'Viña del Mar', region: 'Valparaíso' }),
  dest({ numero: '2002', pedido_numero: '2002', comuna: 'Concepción', region: 'Biobío' }),
  dest({ numero: '2003', pedido_numero: '2003', comuna: 'Antofagasta', region: 'Antofagasta' }),
  dest({ numero: '2004', pedido_numero: '2004', comuna: 'Ñuñoa' }),
  dest({ numero: '2005', pedido_numero: '2005', comuna: 'Las Condes' }),
  dest({ numero: '2006', pedido_numero: '2006', comuna: 'Quilpué', region: 'Valparaíso' }),
  dest({ numero: '2007', pedido_numero: '2007', comuna: 'Puerto Montt', region: 'Los Lagos' }),
  dest({ numero: '2008', pedido_numero: '2008', comuna: 'Maipú', region: null }), // comuna sin región conocida
]
const gr = Dp.agruparPorDestino(surtido)
chequeo('primero la región Metropolitana y después las demás en orden alfabético; al final la que no tiene región', eq(gr.regiones.map((r) => r.nombre), [RM, 'Antofagasta', 'Biobío', 'Los Lagos', 'Valparaíso', null]), gr.regiones.map((r) => r.nombre).join())
chequeo('dentro de cada región, las comunas en orden alfabético (Valparaíso: Quilpué antes que Viña del Mar)', eq(gr.regiones.find((r) => r.nombre === RM).comunas.map((c) => c.nombre), ['Las Condes', 'Ñuñoa']) && eq(gr.regiones.find((r) => r.nombre === 'Valparaíso').comunas.map((c) => c.nombre), ['Quilpué', 'Viña del Mar']))
chequeo('cada región cuenta sus muebles (RM: 2, Valparaíso: 2)', gr.regiones.find((r) => r.nombre === RM).total === 2 && gr.regiones.find((r) => r.nombre === 'Valparaíso').total === 2)
chequeo('una región escrita con espacios cuenta como la misma', Dp.agruparPorDestino([dest({ region: RM }), dest({ region: ' ' + RM + ' ' })]).regiones.length === 1)

/* Antigüedad: el más antiguo primero, por fecha del pedido o por el inicio del plazo si se cambió a mano. */
const edad = (numero, fecha, extra = {}) => dest({ numero, pedido_numero: numero, fecha_pedido: fecha, ...extra })
const viejos = [
  edad('3005', '2026-10-25'),
  edad('3001', '2026-10-30'),
  edad('3003', '2026-10-10', { plazo_desde: '2026-11-05' }), // pedido antiguo, pero el plazo se contó desde el 5-nov: es el más nuevo
  edad('3002', '2026-10-01'),
  edad('3004', '2026-10-25'), // misma fecha que 3005: por número de pedido
  edad('3006', '2026-11-02', { plazo_desde: '2026-11-03' }),
]
const ordenado = Dp.agruparPorDestino(viejos).regiones[0].comunas[0].muebles.map((o) => o.numero)
chequeo('dentro de una comuna: el pedido más antiguo primero (fecha del pedido o inicio del plazo cambiado a mano; empate por número)', eq(ordenado, ['3002', '3004', '3005', '3001', '3006', '3003']), ordenado.join())
chequeo('la fecha de inicio del plazo reemplaza a la del pedido (3003: pedido del 10-oct, plazo desde el 5-nov, queda al final)', ordenado.at(-1) === '3003')
chequeo('el comparador deja primero al más antiguo y es estable para iguales', Dp.compararAntiguedad(viejos[3], viejos[0]) < 0 && Dp.compararAntiguedad(viejos[4], viejos[0]) < 0 && Dp.compararAntiguedad(viejos[0], viejos[0]) === 0)
const rutaAntigua = Dp.agruparPorDestino([dest({ numero: '4002', pedido_numero: '4002', comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO', fecha_pedido: '2026-10-01' }), dest({ numero: '4001', pedido_numero: '4001', comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO', fecha_pedido: '2026-10-20' })])
chequeo('"Sin dirección" sigue ordenado por número de pedido, como antes', eq(rutaAntigua.sinDireccion.map((o) => o.numero), ['4001', '4002']))

sec('Lista plana y bloques de cada página')
const grande = [
  ...Array.from({ length: 4 }, (_, i) => dest({ numero: String(5000 + i), pedido_numero: String(5000 + i), comuna: 'Providencia', fecha_pedido: '2026-10-0' + (i + 1) })),
  ...Array.from({ length: 3 }, (_, i) => dest({ numero: String(5100 + i), pedido_numero: String(5100 + i), comuna: 'Las Condes', fecha_pedido: '2026-10-0' + (i + 1) })),
  ...Array.from({ length: 3 }, (_, i) => dest({ numero: String(5200 + i), pedido_numero: String(5200 + i), comuna: 'Antofagasta', region: 'Antofagasta', fecha_pedido: '2026-10-0' + (i + 1) })),
  dest({ numero: '5300', pedido_numero: '5300', comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO' }),
  dest({ numero: '5400', pedido_numero: '5400', comuna: 'RETIRO TIENDA' }),
]
const lista = Dp.aplanarDespachos(Dp.agruparPorDestino(grande))
chequeo('la lista plana sigue el orden de pantalla: Las Condes, Providencia, Antofagasta, Sin dirección y Retiro (12 muebles)', lista.length === 12 && eq(lista.map((f) => f.titulo).filter((t, i, a) => a.indexOf(t) === i), ['Las Condes', 'Providencia', 'Antofagasta', 'Sin dirección', 'Retiro en tienda']), lista.map((f) => f.titulo).join())
chequeo('cada fila sabe su posición dentro del grupo y el tamaño del grupo completo', lista[0].indice === 0 && lista[0].totalGrupo === 3 && lista[5].titulo === 'Providencia' && lista[5].indice === 2 && lista[5].totalGrupo === 4)
const unaPagina = Dp.bloquesDeFilas(lista.slice(0, 5)) // Las Condes (3) y 2 de Providencia
chequeo('una página que corta un grupo: el último bloque "sigue" y no es continuación', unaPagina.length === 2 && unaPagina[1].titulo === 'Providencia' && unaPagina[1].muebles.length === 2 && unaPagina[1].sigue === true && unaPagina[1].continua === false && unaPagina[0].sigue === false)
const siguiente = Dp.bloquesDeFilas(lista.slice(5, 11))
chequeo('la página siguiente repite el encabezado del grupo cortado: primer bloque "continúa" (Providencia, 2 de 4)', siguiente[0].titulo === 'Providencia' && siguiente[0].continua === true && siguiente[0].sigue === false && siguiente[0].muebles.length === 2 && siguiente[0].totalGrupo === 4, JSON.stringify(siguiente.map((b) => [b.titulo, b.continua, b.sigue])))
chequeo('el encabezado de región va en el primer bloque de cada región de la página (también si es continuación)', unaPagina[0].nuevaRegion === true && unaPagina[1].nuevaRegion === false && siguiente[0].nuevaRegion === true && siguiente[1].nuevaRegion === true && siguiente[1].region === 'Antofagasta')
chequeo('"Sin dirección" y "Retiro" no llevan encabezado de región', Dp.bloquesDeFilas(lista.slice(10)).every((b) => b.nuevaRegion === false))
chequeo('los bloques no se pierden muebles: la suma de todas las páginas de 5 es la lista completa', (() => { let n = 0; for (let i = 0; i < lista.length; i += 5) n += Dp.bloquesDeFilas(lista.slice(i, i + 5)).reduce((s, b) => s + b.muebles.length, 0); return n === lista.length })())

sec('Filtros: búsqueda, región y comuna')
const num = (numero, extra = {}) => dest({ numero, pedido_numero: numero.replace(/-.*/, ''), ...extra })
const mezcla = [
  num('1180-1', { comuna: 'Providencia' }),
  num('1180-2', { comuna: 'Providencia' }),
  num('1181', { comuna: 'Ñuñoa' }),
  num('T9301', { comuna: 'Viña del Mar', region: 'Valparaíso' }),
  num('T9302', { comuna: 'Viña del Mar', region: 'Valparaíso' }),
  num('T9303', { comuna: 'Quilpué', region: 'Valparaíso' }),
  num('1190', { comuna: 'Concepción', region: 'Biobío' }),
  num('1191', { comuna: 'Maipú', region: null }),
  num('1192', { comuna: 'NO SE PROPORCIONÓ DIRECCIÓN DE ENVÍO' }),
  num('1193', { comuna: 'RETIRO TIENDA' }),
  num('1194', { comuna: 'Providencia', cancelado_en: '2026-10-25T00:00:00Z' }), // cancelado: no cuenta
  num('1195', { comuna: 'Providencia', estado: 'por_fabricar' }), // por fabricar: no cuenta
]
chequeo('búsqueda: "1180" encuentra el pedido y sus dos muebles; "#1180" y " 1180 " igual', ['1180', '#1180', ' 1180 '].every((t) => mezcla.filter((o) => Dp.coincideBusqueda(o, t)).map((o) => o.numero).join() === '1180-1,1180-2'))
chequeo('búsqueda: "118" encuentra todo lo que empieza o contiene "118" (1180-1, 1180-2, 1181); "t93" sin importar mayúsculas', mezcla.filter((o) => Dp.coincideBusqueda(o, '118')).length === 3 && mezcla.filter((o) => Dp.coincideBusqueda(o, 't93')).length === 3)
chequeo('búsqueda vacía coincide con todo; un texto que no está, con nada', mezcla.every((o) => Dp.coincideBusqueda(o, '')) && !mezcla.some((o) => Dp.coincideBusqueda(o, '99999')))
const F = (extra) => ({ ...Dp.FILTROS_DESPACHOS_VACIOS, ...extra })
const pasan = (f) => mezcla.filter(Dp.esDespachable).filter((o) => Dp.coincideFiltros(o, f)).map((o) => o.numero).join()
chequeo('sin filtros pasan los 10 muebles que esperan entrega', mezcla.filter(Dp.esDespachable).length === 10 && mezcla.filter(Dp.esDespachable).every((o) => Dp.coincideFiltros(o, F({}))) && !Dp.hayFiltrosDespachos(F({})))
chequeo('región Valparaíso: sus 3 muebles', pasan(F({ region: 'Valparaíso' })) === 'T9301,T9302,T9303')
chequeo('región + comuna (Valparaíso + Quilpué): 1 mueble; comuna sola (viña del mar): 2', pasan(F({ region: 'Valparaíso', comuna: 'quilpué' })) === 'T9303' && pasan(F({ comuna: 'viña del mar' })) === 'T9301,T9302')
chequeo('región con comuna que no es de esa región: nada', pasan(F({ region: RM, comuna: 'quilpué' })) === '')
chequeo('los grupos especiales se filtran solos: Sin dirección (1192), Retiro (1193) y Región sin informar (1191)', pasan(F({ region: Dp.FILTRO_SIN_DIRECCION })) === '1192' && pasan(F({ region: Dp.FILTRO_RETIRO })) === '1193' && pasan(F({ region: Dp.FILTRO_SIN_REGION })) === '1191')
chequeo('región + búsqueda: Valparaíso y "9302" → T9302', pasan(F({ region: 'Valparaíso', busqueda: '9302' })) === 'T9302')
chequeo('hayFiltros: cualquier filtro puesto lo activa (un texto de solo espacios, no)', Dp.hayFiltrosDespachos(F({ region: 'Biobío' })) && Dp.hayFiltrosDespachos(F({ comuna: 'x' })) && Dp.hayFiltrosDespachos(F({ busqueda: '1' })) && !Dp.hayFiltrosDespachos(F({ busqueda: '   ' })))

const ops = Dp.opcionesDeRegion(mezcla, '')
chequeo('el selector de región: Metropolitana (3), Biobío (1), Valparaíso (3), Región sin informar (1), Sin dirección (1), Retiro en tienda (1) y con su conteo', eq(ops.map((o) => [o.etiqueta, o.total]), [[RM, 3], ['Biobío', 1], ['Valparaíso', 3], ['Región sin informar', 1], ['Sin dirección', 1], ['Retiro en tienda', 1]]), JSON.stringify(ops.map((o) => [o.etiqueta, o.total])))
chequeo('no ofrece regiones sin muebles (el cancelado y el por fabricar no cuentan)', !ops.some((o) => o.total === 0) && ops.reduce((s, o) => s + o.total, 0) === 10)
chequeo('el texto de búsqueda ajusta los conteos y quita lo que queda en 0 (búsqueda "T93": solo Valparaíso 3)', eq(Dp.opcionesDeRegion(mezcla, 'T93').map((o) => [o.etiqueta, o.total]), [['Valparaíso', 3]]))
chequeo('comunas de una región: solo las suyas, en orden alfabético y con conteo (Valparaíso: Quilpué 1, Viña del Mar 2)', eq(Dp.opcionesDeComuna(mezcla, 'Valparaíso', '').map((o) => [o.etiqueta, o.total]), [['Quilpué', 1], ['Viña del Mar', 2]]))
chequeo('comunas de la Metropolitana: Ñuñoa y Providencia (Providencia: 2, sin el cancelado ni el por fabricar)', eq(Dp.opcionesDeComuna(mezcla, RM, '').map((o) => [o.etiqueta, o.total]), [['Ñuñoa', 1], ['Providencia', 2]]))
chequeo('sin región elegida: todas las comunas, por región (Metropolitana, Biobío, Valparaíso, sin región) y alfabéticas dentro', eq(Dp.opcionesDeComuna(mezcla, '', '').map((o) => o.etiqueta), ['Ñuñoa', 'Providencia', 'Concepción', 'Quilpué', 'Viña del Mar', 'Maipú']), Dp.opcionesDeComuna(mezcla, '', '').map((o) => o.etiqueta).join())
chequeo('los grupos especiales no tienen comunas', Dp.opcionesDeComuna(mezcla, Dp.FILTRO_SIN_DIRECCION, '').length === 0 && Dp.opcionesDeComuna(mezcla, Dp.FILTRO_RETIRO, '').length === 0)
chequeo('"Sin dirección" y "Retiro" tampoco cuentan como comunas de "Todas"', !Dp.opcionesDeComuna(mezcla, '', '').some((o) => /dirección|retiro/i.test(o.etiqueta)))
const filtradas = mezcla.filter((o) => Dp.coincideFiltros(o, F({ region: RM })))
const gf = Dp.agruparPorDestino(filtradas)
chequeo('al filtrar, el orden de siempre se mantiene dentro (región → comuna → antigüedad) y los grupos especiales quedan fuera', eq(gf.regiones.map((r) => r.nombre), [RM]) && gf.sinDireccion.length === 0 && gf.retiros.length === 0 && eq(gf.regiones[0].comunas.map((c) => c.nombre), ['Ñuñoa', 'Providencia']))

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
