import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../store/useAppStore'

interface MarkdownPreviewProps {
  content: string
  workspaceId: string
  editorPaneId: string
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, workspaceId, editorPaneId }) => {
  const addBrowserPane = useAppStore(s => s.addBrowserPane)

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href?: string) => {
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault()
      addBrowserPane(workspaceId, {
        id: crypto.randomUUID(),
        tabId: workspaceId,
        url: href,
        position: 0,
        createdAt: Date.now()
      }, editorPaneId, 'vertical')
    }
  }

  return (
    <div style={{
      padding: '24px 32px',
      overflowY: 'auto',
      position: 'absolute',
      inset: 0,
      backgroundColor: 'var(--bg-main)',
      color: 'var(--text-active)',
      fontFamily: 'var(--app-font-family)',
      lineHeight: 1.6,
      fontSize: 14,
      boxSizing: 'border-box'
    }} className="markdown-body">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, href, ...props }) => (
            <a 
              {...props} 
              href={href} 
              onClick={(e) => handleLinkClick(e as any, href)} 
              style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' }} 
            />
          ),
          code: ({ node, inline, className, children, ...props }: any) => {
            return !inline ? (
              <pre style={{ backgroundColor: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', overflowX: 'auto', marginTop: 16, marginBottom: 16 }}>
                <code className={className} {...props} style={{ fontFamily: 'var(--terminal-font-family, monospace)', fontSize: 13 }}>
                  {children}
                </code>
              </pre>
            ) : (
              <code className={className} {...props} style={{ backgroundColor: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: '4px', fontFamily: 'var(--terminal-font-family, monospace)', fontSize: 13 }}>
                {children}
              </code>
            )
          },
          h1: ({node, ...props}) => <h1 {...props} style={{ borderBottom: '1px solid var(--border-inactive)', paddingBottom: '8px', marginTop: '24px', marginBottom: '16px' }} />,
          h2: ({node, ...props}) => <h2 {...props} style={{ borderBottom: '1px solid var(--border-inactive)', paddingBottom: '6px', marginTop: '24px', marginBottom: '16px' }} />,
          h3: ({node, ...props}) => <h3 {...props} style={{ marginTop: '20px', marginBottom: '12px' }} />,
          table: ({node, ...props}) => <table {...props} style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 16 }} />,
          th: ({node, ...props}) => <th {...props} style={{ border: '1px solid var(--border-inactive)', padding: '6px 13px', backgroundColor: 'var(--bg-secondary)' }} />,
          td: ({node, ...props}) => <td {...props} style={{ border: '1px solid var(--border-inactive)', padding: '6px 13px' }} />,
          blockquote: ({node, ...props}) => <blockquote {...props} style={{ borderLeft: '4px solid var(--border-inactive)', margin: 0, padding: '0 1em', color: 'var(--text-dim)' }} />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
