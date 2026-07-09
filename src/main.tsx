
import './styles/globals.css'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DictationOverlayApp, isDictationOverlayEntry } from './components/ui/DictationOverlayApp'

import { ErrorBoundary } from './components/ui/ErrorBoundary'

const Root = isDictationOverlayEntry(window.location.search) ? DictationOverlayApp : App

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
)
