import { RotateCw } from 'lucide-react'
import { useState } from 'react'
import { ProduccionLista } from '../components/ProduccionLista'
import { SincronizacionShopify } from '../components/SincronizacionShopify'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'

/* Pedidos de Shopify convertidos en órdenes de fabricación: los de la tienda
   en línea y los creados a mano en Shopify, juntos en una sola vista (se
   distinguen por el filtro y el chip de origen). Solo administrador y bodega
   llegan hasta aquí (ruta protegida y políticas de la base de datos). */
export function Pedidos() {
  const esEscritorio = useEsEscritorio()
  const { rol } = useAuth()
  const [recargaToken, setRecargaToken] = useState(0)

  return (
    <Shell
      eyebrow="OPERACIÓN"
      title="Pedidos"
      actions={
        <Button variant="secondary" iconLeft={<RotateCw size={15} />} onClick={() => setRecargaToken((n) => n + 1)}>
          {esEscritorio ? 'Recargar' : ''}
        </Button>
      }
    >
      {/* Solo el administrador: la lectura de sync_shopify y la Edge Function también lo exigen. */}
      {rol === 'administrador' && <SincronizacionShopify alTerminar={() => setRecargaToken((n) => n + 1)} />}
      <ProduccionLista recargaToken={recargaToken} />
    </Shell>
  )
}
