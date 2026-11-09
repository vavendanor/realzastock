import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { HojaNueva } from './pages/HojaNueva'
import { Hojas } from './pages/Hojas'
import { Inicio } from './pages/Inicio'
import { Inventario } from './pages/Inventario'
import { InventarioForm } from './pages/InventarioForm'
import { Login } from './pages/Login'
import { OrdenDetalle } from './pages/OrdenDetalle'
import { Pedidos } from './pages/Pedidos'
import { Probador } from './pages/Probador'
import { Reporte } from './pages/Reporte'
import { UsuarioNuevo } from './pages/UsuarioNuevo'
import { Usuarios } from './pages/Usuarios'
import { Ventas } from './pages/Ventas'
import { VentaNueva } from './pages/VentaNueva'

/* Módulos listos: Inventario (administrador), Ventas (administrador y
   vendedor), Pedidos (órdenes de fabricación de Shopify: administrador y
   bodega), Hojas de fabricación (administrador y bodega), Probador de
   colores (administrador y bodega), Reporte y Usuarios (exclusivos de
   administrador). */
function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Inicio />
          </ProtectedRoute>
        }
      />

      <Route
        path="/inventario"
        element={
          <ProtectedRoute roles={['administrador']}>
            <Inventario />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventario/nuevo"
        element={
          <ProtectedRoute roles={['administrador']}>
            <InventarioForm />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventario/:id"
        element={
          <ProtectedRoute roles={['administrador']}>
            <InventarioForm />
          </ProtectedRoute>
        }
      />

      <Route
        path="/ventas"
        element={
          <ProtectedRoute roles={['administrador', 'vendedor']}>
            <Ventas />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ventas/nueva"
        element={
          <ProtectedRoute roles={['administrador', 'vendedor']}>
            <VentaNueva />
          </ProtectedRoute>
        }
      />

      <Route
        path="/pedidos"
        element={
          <ProtectedRoute roles={['administrador', 'bodega']}>
            <Pedidos />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pedidos/:id"
        element={
          <ProtectedRoute roles={['administrador', 'bodega']}>
            <OrdenDetalle />
          </ProtectedRoute>
        }
      />

      <Route
        path="/hojas"
        element={
          <ProtectedRoute roles={['administrador', 'bodega']}>
            <Hojas />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hojas/nueva"
        element={
          <ProtectedRoute roles={['administrador', 'bodega']}>
            <HojaNueva />
          </ProtectedRoute>
        }
      />

      <Route
        path="/reporte"
        element={
          <ProtectedRoute roles={['administrador']}>
            <Reporte />
          </ProtectedRoute>
        }
      />

      <Route
        path="/probador"
        element={
          <ProtectedRoute roles={['administrador', 'bodega']}>
            <Probador />
          </ProtectedRoute>
        }
      />

      <Route
        path="/usuarios"
        element={
          <ProtectedRoute roles={['administrador']}>
            <Usuarios />
          </ProtectedRoute>
        }
      />
      <Route
        path="/usuarios/nuevo"
        element={
          <ProtectedRoute roles={['administrador']}>
            <UsuarioNuevo />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
