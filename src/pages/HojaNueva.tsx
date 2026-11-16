import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AgregarPedidoPorNumero } from '../components/AgregarPedidoPorNumero'
import { ProduccionLista, type SeleccionDePedidos } from '../components/ProduccionLista'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { hoyEnChile } from '../lib/diasHabiles'
import {
  crearHoja,
  descripcionDeResumen,
  errorDeNombre,
  MAX_NOMBRE_HOJA,
  MAX_PEDIDOS_POR_HOJA,
  nombreSugerido,
  obtenerResumenesPedidos,
  type ResumenPedido,
} from '../lib/hojas'

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/* Crear una hoja de fabricación: se eligen pedidos en la tabla en vivo (o por su número) y se
   les pone nombre. Un mismo pedido puede estar en varias hojas. */
export function HojaNueva() {
  const navigate = useNavigate()
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(() => new Set())
  const [resumenes, setResumenes] = useState<ReadonlyMap<string, ResumenPedido>>(() => new Map())
  const pedidosConsultados = useRef(new Set<string>())

  const [nombre, setNombre] = useState(() => nombreSugerido(hoyEnChile()))
  const [creando, setCreando] = useState(false)
  const [errorCrear, setErrorCrear] = useState<string | null>(null)
  const [nombreTocado, setNombreTocado] = useState(false)

  const alternar = useCallback((pedido: string) => {
    setElegidos((previos) => {
      const nuevos = new Set(previos)
      if (!nuevos.delete(pedido)) nuevos.add(pedido)
      return nuevos
    })
  }, [])
  const fijar = useCallback((pedidos: readonly string[], elegir: boolean) => {
    setElegidos((previos) => {
      const nuevos = new Set(previos)
      for (const p of pedidos) {
        if (elegir) nuevos.add(p)
        else nuevos.delete(p)
      }
      return nuevos
    })
  }, [])
  const seleccion = useMemo<SeleccionDePedidos>(() => ({ elegidos, alternar, fijar }), [elegidos, alternar, fijar])

  /* Datos de los pedidos elegidos (piezas, modelos) para mostrarlos en el panel. */
  useEffect(() => {
    const faltan = [...elegidos].filter((p) => !pedidosConsultados.current.has(p))
    if (faltan.length === 0) return
    faltan.forEach((p) => pedidosConsultados.current.add(p))
    void obtenerResumenesPedidos(faltan)
      .then((nuevos) => setResumenes((previos) => new Map([...previos, ...nuevos])))
      .catch(() => faltan.forEach((p) => pedidosConsultados.current.delete(p)))
  }, [elegidos])

  const agregarPorNumero = (resumen: ResumenPedido) => {
    pedidosConsultados.current.add(resumen.pedidoNumero)
    setResumenes((previos) => new Map(previos).set(resumen.pedidoNumero, resumen))
    fijar([resumen.pedidoNumero], true)
  }

  const errorNombre = errorDeNombre(nombre)
  const excedido = elegidos.size > MAX_PEDIDOS_POR_HOJA
  const piezasElegidas = [...elegidos].reduce((suma, p) => suma + (resumenes.get(p)?.piezas ?? 0), 0)

  const crear = async () => {
    setNombreTocado(true)
    setErrorCrear(null)
    if (errorNombre || elegidos.size === 0 || excedido) return
    setCreando(true)
    try {
      await crearHoja(nombre, [...elegidos])
      navigate('/hojas')
    } catch (err) {
      setErrorCrear(err instanceof Error ? err.message : 'No se pudo crear la hoja.')
      setCreando(false)
    }
  }

  return (
    <Shell eyebrow="OPERACIÓN" title="Nueva hoja de fabricación">
      <Card
        title="Hoja en preparación"
        subtitle={
          elegidos.size === 0
            ? 'Elige pedidos en la tabla de abajo o agrégalos por número.'
            : `${plural(elegidos.size, 'pedido', 'pedidos')} · ${plural(piezasElegidas, 'pieza', 'piezas')}`
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <Input
            label="Nombre de la hoja"
            value={nombre}
            maxLength={MAX_NOMBRE_HOJA + 20}
            onChange={(e) => setNombre(e.target.value)}
            onBlur={() => setNombreTocado(true)}
            error={(nombreTocado || nombre.trim().length > MAX_NOMBRE_HOJA) && errorNombre ? errorNombre : undefined}
          />

          <AgregarPedidoPorNumero incluidos={elegidos} alAgregar={agregarPorNumero} />

          {elegidos.size > 0 && (
            <ul
              aria-label="Pedidos de la hoja"
              style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
            >
              {[...elegidos].map((p) => {
                const r = resumenes.get(p)
                return (
                  <li
                    key={p}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: '0 var(--space-2)' }}
                  >
                    <span style={{ minWidth: 0, font: 'var(--type-body)', color: 'var(--text-body)' }}>
                      <strong className="rh-num" style={{ color: 'var(--text-strong)' }}>
                        {p}
                      </strong>
                      {r && <span style={{ color: 'var(--text-muted)' }}> · {descripcionDeResumen(r)}</span>}
                    </span>
                    <Button size="sm" variant="ghost" aria-label={`Quitar el pedido ${p} de la hoja`} iconLeft={<X size={15} />} onClick={() => fijar([p], false)} />
                  </li>
                )
              })}
            </ul>
          )}

          {excedido && (
            <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
              Una hoja admite hasta {MAX_PEDIDOS_POR_HOJA} pedidos (hay {elegidos.size}). Quita algunos.
            </span>
          )}
          {errorCrear && (
            <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>
              {errorCrear}
            </span>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Button disabled={creando || elegidos.size === 0 || excedido || errorNombre !== null} onClick={() => void crear()}>
              {creando ? 'Creando...' : 'Crear hoja'}
            </Button>
            <Button variant="ghost" disabled={creando} onClick={() => navigate('/hojas')}>
              Cancelar
            </Button>
          </div>
        </div>
      </Card>

      <ProduccionLista recargaToken={0} seleccion={seleccion} />
    </Shell>
  )
}
