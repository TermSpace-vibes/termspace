import React from 'react';

export class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorMsg: '', errorStack: '' };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorMsg: error.message, errorStack: error.stack };
  }

  componentDidCatch(_error: any, info: any) {
    this.setState({ errorStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 24,
          background: 'var(--bg-main, #1a1612)',
          color: '#ef4444',
          height: '100%',
          width: '100%',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          border: '1px solid #ef4444',
          borderRadius: 8,
          boxSizing: 'border-box'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 24 }}>⚠️</span>
            <h2 style={{ margin: 0, color: '#ef4444', fontSize: 18, fontWeight: 600 }}>Pane Crashed</h2>
          </div>
          <p style={{ margin: '0 0 16px 0', color: 'var(--text-active, #e8a045)', fontSize: 14 }}>
            {this.state.errorMsg}
          </p>
          <pre style={{
            background: 'var(--bg-sidebar, #221e18)',
            color: 'var(--text-inactive, #5a5040)',
            padding: 12,
            borderRadius: 6,
            fontSize: 11,
            overflowX: 'auto',
            width: '100%',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}>
            {this.state.errorStack}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 16,
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid #ef4444',
              color: '#ef4444',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12
            }}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
