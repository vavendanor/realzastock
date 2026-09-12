import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Breadcrumb } from '../components/ui/Breadcrumb'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { crearUsuario, ROL_LABEL, ROLES } from '../lib/usuarios'
import type { UserRole } from '../types'

export function UsuarioNuevo() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()

  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState<UserRole>('vendedor')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const puedeConfirmar = nombre.trim() !== '' && email.trim() !== '' && password.length >= 8 && !guardando

  const confirmar = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setGuardando(true)
    try {
      await crearUsuario({ nombre, email, password, rol })
      navigate('/usuarios')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Shell
      eyebrow="ADMINISTRACIÓN"
      title="Nuevo usuario"
      actions={
        esEscritorio ? (
          <Button variant="secondary" onClick={() => navigate('/usuarios')} disabled={guardando}>
            Cancelar
          </Button>
        ) : null
      }
    >
      {esEscritorio && <Breadcrumb items={[{ label: 'Usuarios', to: '/usuarios' }, { label: 'Nuevo usuario' }]} />}

      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      <Card>
        <form onSubmit={confirmar} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: esEscritorio ? '1fr 1fr' : '1fr', gap: 'var(--space-4)' }}>
            <Input
              label="Nombre"
              required
              size={esEscritorio ? 'md' : 'touch'}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre y apellido"
            />
            <Input
              label="Email"
              type="email"
              required
              size={esEscritorio ? 'md' : 'touch'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="persona@realzahogar.cl"
            />
            <Input
              label="Contraseña temporal"
              type="password"
              required
              size={esEscritorio ? 'md' : 'touch'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="Mínimo 8 caracteres. Compártesela por un canal seguro para que la cambie al entrar."
            />
            <Select
              label="Rol"
              size={esEscritorio ? 'md' : 'touch'}
              value={rol}
              onChange={(e) => setRol(e.target.value as UserRole)}
              options={ROLES.map((r) => ({ value: r, label: ROL_LABEL[r] }))}
            />
          </div>

          <Button
            type="submit"
            size={esEscritorio ? 'lg' : 'touch'}
            variant="accent"
            fullWidth={!esEscritorio}
            disabled={!puedeConfirmar}
            iconLeft={<Check size={17} />}
          >
            {guardando ? 'Creando...' : 'Crear usuario'}
          </Button>

          <p style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
            La cuenta queda activa de inmediato (no requiere confirmar el correo). Podrá iniciar sesión con este
            email y la contraseña que definas acá.
          </p>
        </form>
      </Card>
    </Shell>
  )
}
