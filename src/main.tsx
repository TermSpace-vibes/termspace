
import './styles/globals.css'
import ReactDOM from 'react-dom/client'
import App from './App'

import { ErrorBoundary } from './components/ui/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
