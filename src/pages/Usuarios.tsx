import { CirclePlus, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shell } from '../components/layout/Shell'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { DataTable, type Column } from '../components/ui/DataTable'
import { IconButton } from '../components/ui/IconButton'
import { Select } from '../components/ui/Select'
import { useAuth } from '../hooks/useAuth'
import { useEsEscritorio } from '../hooks/useMediaQuery'
import { actualizarRolUsuario, listarUsuarios, ROL_LABEL, ROLES } from '../lib/usuarios'
import type { Usuario, UserRole } from '../types'

function formatearFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-CL')
}

export function Usuarios() {
  const navigate = useNavigate()
  const esEscritorio = useEsEscritorio()
  const { user } = useAuth()

  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /* Mientras se guarda el cambio de rol de una fila puntual, solo esa fila
     queda deshabilitada — no toda la tabla. */
  const [guardandoId, setGuardandoId] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setUsuarios(await listarUsuarios())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al cargar los usuarios')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiarRol = async (usuario: Usuario, rol: UserRole) => {
    setError(null)
    /* Optimista: se refleja al toque y, si el servidor lo rechaza, se
       revierte solo esa fila en vez de recargar todo. */
    const anterior = usuario.rol
    setUsuarios((previos) => previos.map((u) => (u.id === usuario.id ? { ...u, rol } : u)))
    setGuardandoId(usuario.id)

    try {
      await actualizarRolUsuario(usuario.id, rol)
    } catch (err) {
      setUsuarios((previos) => previos.map((u) => (u.id === usuario.id ? { ...u, rol: anterior } : u)))
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el rol')
    } finally {
      setGuardandoId(null)
    }
  }

  const SelectorRol = ({ usuario }: { usuario: Usuario }) => {
    const esUnoMismo = usuario.id === user?.id
    return (
      <Select
        size="sm"
        value={usuario.rol}
        disabled={esUnoMismo || guardandoId === usuario.id}
        onChange={(e) => void cambiarRol(usuario, e.target.value as UserRole)}
        options={ROLES.map((r) => ({ value: r, label: ROL_LABEL[r] }))}
        hint={esUnoMismo ? 'No puedes cambiar tu propio rol' : undefined}
        wrapperStyle={{ width: esEscritorio ? 180 : '100%' }}
      />
    )
  }

  const columnas: Column<Usuario>[] = [
    {
      key: 'nombre',
      header: 'Nombre',
      render: (r) => <span style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{r.nombre}</span>,
    },
    { key: 'email', header: 'Email', render: (r) => <span style={{ color: 'var(--text-muted)' }}>{r.email}</span> },
    { key: 'rol', header: 'Rol', render: (r) => <SelectorRol usuario={r} /> },
    {
      key: 'creado',
      header: 'Creado',
      render: (r) => <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{formatearFecha(r.creadoEn)}</span>,
    },
  ]

  return (
    <Shell
      eyebrow="ADMINISTRACIÓN"
      title="Usuarios"
      actions={
        <>
          <IconButton label="Recargar" variant="outline" onClick={() => void cargar()}>
            <RotateCw size={15} />
          </IconButton>
          <Button iconLeft={<CirclePlus size={16} />} onClick={() => navigate('/usuarios/nuevo')}>
            {esEscritorio ? 'Nuevo usuario' : 'Nuevo'}
          </Button>
        </>
      }
    >
      {error && (
        <Card padding="var(--space-4) var(--space-6)" style={{ borderColor: 'var(--state-danger)' }}>
          <span style={{ font: 'var(--type-body)', color: 'var(--state-danger)' }}>{error}</span>
        </Card>
      )}

      {esEscritorio ? (
        <Card padding="0" title="Cuentas" subtitle={cargando ? 'Cargando...' : `${usuarios.length} usuarios`}>
          <DataTable rows={usuarios} columns={columnas} emptyLabel={cargando ? 'Cargando usuarios...' : 'No hay usuarios registrados'} />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {cargando && (
            <Card>
              <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>Cargando usuarios...</span>
            </Card>
          )}
          {!cargando && usuarios.length === 0 && (
            <Card>
              <span style={{ font: 'var(--type-body)', color: 'var(--text-muted)' }}>No hay usuarios registrados.</span>
            </Card>
          )}
          {usuarios.map((usuario) => (
            <Card key={usuario.id} padding="var(--space-4)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <div style={{ font: 'var(--type-body-strong)', color: 'var(--text-strong)' }}>{usuario.nombre}</div>
                  <div style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{usuario.email}</div>
                  <div style={{ font: 'var(--type-caption)', color: 'var(--text-faint)' }}>
                    Creado el {formatearFecha(usuario.creadoEn)}
                  </div>
                </div>
                <SelectorRol usuario={usuario} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Shell>
  )
}
