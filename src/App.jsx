import { useEffect, useState } from 'react'
import Start from './pages/Start.jsx'
import Present from './pages/Present.jsx'
import Control from './pages/Control.jsx'

// Tiny hash router. Routes: #/ (start), #/present, #/control.
// The query string after the route carries the session code, e.g. #/present?c=K7PM4Q.
function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  const params = new URLSearchParams(query)
  return { path, params }
}

export default function App() {
  const [route, setRoute] = useState(parseHash())

  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  if (route.path === '/present') return <Present params={route.params} />
  if (route.path === '/control') return <Control params={route.params} />
  return <Start />
}
