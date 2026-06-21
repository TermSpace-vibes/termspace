import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
  resetLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ 
          padding: 20, 
          background: 'var(--bg-main)', 
          color: '#ff6b6b', 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          fontFamily: 'var(--app-font-family)'
        }}>
          <h2>Something went wrong.</h2>
          <pre style={{ maxWidth: '80%', overflow: 'auto', background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 8 }}>
            {this.state.error?.toString()}
          </pre>
          <div style={{ display: 'flex', gap: 16 }}>
            <button 
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                marginTop: 16,
                padding: '8px 16px',
                background: 'var(--accent)',
                color: 'var(--bg-main)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Try again
            </button>
            {this.props.onReset && (
              <button 
                onClick={() => {
                  this.props.onReset!();
                  this.setState({ hasError: false, error: null });
                }}
                style={{
                  marginTop: 16,
                  padding: '8px 16px',
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {this.props.resetLabel || 'Reset'}
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
