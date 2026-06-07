import React from 'react'
import './styles/globals.css'
import ReactDOM from 'react-dom/client'
import App from './App'

class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) { super(props); this.state = { hasError: false, errorMsg: '', errorStack: '' }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, errorMsg: error.message, errorStack: error.stack }; }
  componentDidCatch(_error: any, info: any) {
    this.setState({ errorStack: info.componentStack });
  }
  render() { 
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, background: '#880000', color: 'white', height: '100vh', overflow: 'auto' }}>
          <h1>App Crashed!</h1>
          <h3>{this.state.errorMsg}</h3>
          <pre>{this.state.errorStack}</pre>
        </div>
      );
    }
    return this.props.children; 
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
