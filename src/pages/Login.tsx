import { ArrowRight, Lock, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabaseClient'

export function Login() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  /* Cubre dos casos: justo después de un login exitoso (el estado de sesión
     cambia y esto redirige solo), y a alguien que entra a /login a mano
     estando ya logueado. Desde "/", Inicio.tsx manda a cada rol a su lugar. */
  if (user) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setCargando(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setCargando(false)
    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : error.message,
      )
    }
  }

  return (
    <div style={{ minHeight: '100svh', display: 'flex', flexDirection: 'column', background: 'var(--surface-page)' }}>
      <div
        style={{
          flex: '0 0 44px',
          background: 'var(--nogal-700)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--space-10)',
          padding: '0 var(--space-4)',
          font: 'var(--fw-bold) var(--text-body-sm)/1 var(--font-sans)',
          flexWrap: 'wrap',
          textAlign: 'center',
        }}
      >
        <span>✔︎ Garantía de fábrica por 6 meses.</span>
        <span>✔︎ Paga hasta en 12 cuotas sin intereses.</span>
        <span>✔︎ Más de 1000 clientes satisfechos.</span>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr .9fr', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 'var(--space-12) var(--space-16)',
            gap: 'var(--space-8)',
          }}
        >
          <div>
            <div className="rh-eyebrow">PANEL INTERNO</div>
            <h1 style={{ marginTop: 'var(--space-2)' }}>Inventario, ventas y pedidos</h1>
            <p style={{ font: 'var(--type-body)', color: 'var(--text-muted)', marginTop: 'var(--space-3)', maxWidth: '44ch' }}>
              Ingresa con tu cuenta de Realza Hogar. El acceso depende de tu rol: administración, ventas o bodega.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 380 }}>
            <Input
              label="Correo"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              iconLeft={<Mail size={16} />}
            />
            <Input
              label="Contraseña"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              iconLeft={<Lock size={16} />}
            />

            {error && <span style={{ font: 'var(--type-caption)', color: 'var(--state-danger)' }}>{error}</span>}

            <Button type="submit" size="lg" fullWidth disabled={cargando} iconRight={<ArrowRight size={17} />}>
              {cargando ? 'Ingresando...' : 'Entrar al panel'}
            </Button>
          </form>
        </div>

        <div
          style={{
            background: 'var(--nogal-700)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 'var(--space-12)',
            gap: 'var(--space-4)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(120% 90% at 80% 10%,rgba(201,127,63,.35),transparent 60%)',
            }}
          />
          <div style={{ position: 'relative' }}>
            <div
              style={{
                font: 'var(--fw-bold) var(--text-eyebrow)/1.2 var(--font-sans)',
                letterSpacing: 'var(--ls-eyebrow)',
                color: 'var(--cobre-300)',
              }}
            >
              MUEBLES PENSADOS PARA DURAR
            </div>
            <div style={{ font: 'var(--type-h1)', color: '#fff', marginTop: 'var(--space-3)', letterSpacing: 'var(--ls-display)' }}>
              Realza tu hogar,
              <br />
              ordena tu bodega
            </div>
            <p style={{ font: 'var(--type-body)', color: 'rgba(255,255,255,.7)', marginTop: 'var(--space-4)', maxWidth: '34ch' }}>
              Roberto Espinoza 1329, Santiago · Lunes a viernes de 9 a 18 hrs.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
