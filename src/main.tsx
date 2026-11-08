import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './hooks/useAuth.tsx'

/* Router de datos (createBrowserRouter) en lugar de <BrowserRouter>: es el único
   modo en que React Router permite bloquear una navegación con useBlocker, que
   se usará para avisar cuando hay cambios sin guardar.

   Es una sola ruta comodín ("*") que contiene toda la app: App sigue declarando
   sus rutas con <Routes>, igual que antes, y el comportamiento de la navegación
   (redirecciones, botón atrás, 404) no cambia. */
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <AuthProvider>
        <App />
      </AuthProvider>
    ),
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
