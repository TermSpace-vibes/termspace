import React, { useState, useEffect, useCallback, useRef } from 'react'
import { initializeExtensions, registerDynamicTheme } from '../vscode-extensions/setup'
import { Group, Panel, Separator } from 'react-resizable-panels'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { X, Save, Image as ImageIcon, FileCode, ChevronRight, Columns, Rows, Eye, EyeOff, Folder, GitBranch, Search } from 'lucide-react'
import { FileTree } from './FileTree'
import { GitPanel } from './GitPanel'
import { SearchPanel } from './SearchPanel'
import { ConfirmModal } from './ConfirmModal/ConfirmModal'
import { MarkdownPreview } from './MarkdownPreview'
import { readTextFileContent, writeTextFileContent } from '../utils/fs'
import { useAppStore } from '../store/useAppStore'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { ensureLspConnection } from '../utils/lspManager'

interface EditorPaneComponentProps {
  workspaceId: string
  editorPaneId: string
  isActive?: boolean
}

const BINARY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'zip', 'tar', 'gz', 'mp4', 'mp3', 'pdf']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg']

const EDITOR_THEMES: Record<string, {
  base: 'vs' | 'vs-dark'
  bg: string
  panel: string
  surface: string
  border: string
  text: string
  muted: string
  dim: string
  accent: string
  keyword: string
  string: string
  function: string
  type: string
  comment: string
}> = {
  'warm-dark': {
    base: 'vs-dark',
    bg: '#0c0c0e',
    panel: '#131316',
    surface: '#1c1c21',
    border: '#25252c',
    text: '#d4d4d8',
    muted: '#a1a1aa',
    dim: '#71717a',
    accent: '#6366f1',
    keyword: '#a78bfa',
    string: '#4ade80',
    function: '#fbbf24',
    type: '#60a5fa',
    comment: '#71717a',
  },
  'cold-dark': {
    base: 'vs-dark',
    bg: '#11131d',
    panel: '#171925',
    surface: '#202333',
    border: '#2a2f44',
    text: '#c0caf5',
    muted: '#9aa5ce',
    dim: '#565f89',
    accent: '#7dcfff',
    keyword: '#bb9af7',
    string: '#9ece6a',
    function: '#e0af68',
    type: '#7aa2f7',
    comment: '#565f89',
  },
  'catppuccin-mocha': {
    base: 'vs-dark',
    bg: '#181825',
    panel: '#11111b',
    surface: '#24243a',
    border: '#313244',
    text: '#cdd6f4',
    muted: '#bac2de',
    dim: '#6c7086',
    accent: '#89b4fa',
    keyword: '#cba6f7',
    string: '#a6e3a1',
    function: '#f9e2af',
    type: '#89b4fa',
    comment: '#6c7086',
  },
  synthwave: {
    base: 'vs-dark',
    bg: '#21182d',
    panel: '#1a1224',
    surface: '#302342',
    border: '#49336b',
    text: '#f5d7ff',
    muted: '#b89bb4',
    dim: '#8b6f87',
    accent: '#36f9f6',
    keyword: '#ff7edb',
    string: '#72f1b8',
    function: '#fede5d',
    type: '#36f9f6',
    comment: '#8b6f87',
  },
  fruity: {
    base: 'vs-dark',
    bg: '#151515',
    panel: '#111111',
    surface: '#222222',
    border: '#333333',
    text: '#f8f8f2',
    muted: '#a8a8a2',
    dim: '#6272a4',
    accent: '#ff79c6',
    keyword: '#bd93f9',
    string: '#50fa7b',
    function: '#f1fa8c',
    type: '#8be9fd',
    comment: '#6272a4',
  },
  light: {
    base: 'vs',
    bg: '#fbfbfc',
    panel: '#f4f4f5',
    surface: '#ffffff',
    border: '#e4e4e7',
    text: '#18181b',
    muted: '#52525b',
    dim: '#a1a1aa',
    accent: '#2563eb',
    keyword: '#7c3aed',
    string: '#15803d',
    function: '#b45309',
    type: '#0369a1',
    comment: '#71717a',
  },
}

const isBinaryFile = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext ? BINARY_EXTENSIONS.includes(ext) : false
}

const isImageFile = (path: string | null) => {
  if (!path) return false
  const ext = path.split('.').pop()?.toLowerCase()
  return ext ? IMAGE_EXTENSIONS.includes(ext) : false
}

export const EditorPaneComponent: React.FC<EditorPaneComponentProps> = ({
  workspaceId,
  editorPaneId,
  isActive = false,
}) => {
  const editorPane = useAppStore(s => s.editorPanesByTab[workspaceId]?.find(p => p.id === editorPaneId))
  const removeEditorPane = useAppStore(s => s.removeEditorPane)
  const updateEditorPaneFile = useAppStore(s => s.updateEditorPaneFile)
  const updateEditorPaneLayout = useAppStore(s => s.updateEditorPaneLayout)
  const closeEditorFile = useAppStore(s => s.closeEditorFile)
  const splitEditor = useAppStore(s => s.splitEditor)
  const refreshGitStatus = useAppStore(s => s.refreshGitStatus)
  const gitStatus = useAppStore(s => s.gitStatusByWorkspace[workspaceId])
  const addToast = useAppStore(s => s.addToast)
  const settings = useAppStore(s => s.settings)
  const updateSettings = useAppStore(s => s.updateSettings)

  const [fileContent, setFileContent] = useState('')
  const [originalFileContent, setOriginalFileContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [showConfirmDiscard, setShowConfirmDiscard] = useState<{ path: string } | null>(null)
  const [extensionsReady, setExtensionsReady] = useState(false)
  
  const editorRef = useRef<any>(null)
  const blameDecorationRef = useRef<any>(null)
  const blameTimeoutRef = useRef<any>(null)

  const selectAllInEditor = useCallback(() => {
    const editor = editorRef.current
    const model = editor?.getModel?.()
    if (!editor || !model) return false

    editor.setSelection(model.getFullModelRange())
    editor.focus()
    return true
  }, [])

  useEffect(() => {
    if (editorPane?.activeFilePath && editorPane?.rootPath) {
      const language = getLanguageFromPath(editorPane.activeFilePath);
      const supportedLanguages = ['typescript', 'javascript', 'rust', 'python']; // Add more if needed later
      if (supportedLanguages.includes(language)) {
        ensureLspConnection(workspaceId, editorPane.rootPath, language)
          .catch(err => console.error("LSP connection error:", err));
      }
    }
  }, [editorPane?.activeFilePath, editorPane?.rootPath, workspaceId]);
  
  useEffect(() => {
    if (editorRef.current && editorPane?.jumpToLine) {
      const line = editorPane.jumpToLine
      editorRef.current.revealLineInCenter(line)
      editorRef.current.setSelection({
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 1
      })
      editorRef.current.focus()
      
      // Clear jumpToLine after jump to avoid re-jumping
      setTimeout(() => {
        updateEditorPaneLayout(workspaceId, editorPaneId, { jumpToLine: null })
      }, 100)
    }
  }, [editorPane?.jumpToLine, workspaceId, editorPaneId, updateEditorPaneLayout])

  useEffect(() => {
    const handleEditorAction = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (!isActive) return;
      if (editorRef.current) {
        editorRef.current.getAction(customEvent.detail.action)?.run();
      }
    };
    window.addEventListener('termspace:editor-action', handleEditorAction);
    return () => window.removeEventListener('termspace:editor-action', handleEditorAction);
  }, [isActive]);

  useEffect(() => {
    if (editorPane?.rootPath) {
      refreshGitStatus(workspaceId, editorPane.rootPath || "")
    }
  }, [workspaceId, editorPane?.rootPath, refreshGitStatus])

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        // If the active element is an input (excluding Monaco's textarea), let it handle its own select all
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        const isMonacoTextarea = document.activeElement?.classList.contains('inputarea');
        
        if (!isMonacoTextarea && (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable)) {
          return;
        }

        // Only handle if this pane is active
        if (!isActive) return;

        if (selectAllInEditor()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
  }, [isActive, selectAllInEditor]);

  // Theme initialization — registers the dynamic theme as a proper VS Code
  // theme extension contribution (via vscode-extensions/setup.ts) rather
  // than calling the legacy monaco.editor.defineTheme()/setTheme() API,
  // which throws once the workbench theme service override is installed.
  useEffect(() => {
    if (!extensionsReady) return
    const theme = EDITOR_THEMES[settings.theme] || EDITOR_THEMES['warm-dark']
    const themeId = `termspace-dynamic-${settings.theme}`

    const colors = {
      'editor.background': theme.bg,
      'editor.foreground': theme.text,
      'editorLineNumber.foreground': theme.dim,
      'editorLineNumber.activeForeground': theme.muted,
      'editorCursor.foreground': theme.accent,
      'editor.selectionBackground': `${theme.accent}55`,
      'editor.inactiveSelectionBackground': `${theme.accent}2d`,
      'editor.lineHighlightBackground': `${theme.surface}80`,
      'editor.lineHighlightBorder': `${theme.accent}66`,
      'editorIndentGuide.background1': `${theme.border}`,
      'editorIndentGuide.activeBackground1': `${theme.muted}`,
      'editorGutter.background': theme.bg,
      'editorWidget.background': theme.surface,
      'editorWidget.border': theme.border,
      'editorSuggestWidget.background': theme.surface,
      'editorSuggestWidget.border': theme.border,
      'editorSuggestWidget.foreground': theme.text,
      'editorSuggestWidget.highlightForeground': theme.accent,
      'editorSuggestWidget.selectedBackground': `${theme.accent}26`,
      'editorHoverWidget.background': theme.surface,
      'editorHoverWidget.border': theme.border,
      'editorStickyScroll.background': theme.bg,
      'minimap.background': theme.bg,
      'scrollbarSlider.background': `${theme.muted}33`,
      'scrollbarSlider.hoverBackground': `${theme.muted}55`,
      'scrollbarSlider.activeBackground': `${theme.muted}77`,
    }

    // VS Code themes target real TextMate scopes (this app uses
    // @codingame/monaco-vscode-textmate-service-override for tokenization),
    // not the short Monarch token names the old monaco.editor.defineTheme
    // `rules` array used — mapped here to their closest TextMate equivalents.
    const tokenColors = [
      { scope: ['comment'], settings: { foreground: theme.comment, fontStyle: 'italic' } },
      { scope: ['keyword', 'keyword.operator', 'keyword.control'], settings: { foreground: theme.keyword } },
      { scope: ['string'], settings: { foreground: theme.string } },
      { scope: ['constant.numeric'], settings: { foreground: theme.function } },
      { scope: ['entity.name.type', 'support.type'], settings: { foreground: theme.type } },
      { scope: ['entity.name.function', 'support.function'], settings: { foreground: theme.function } },
      { scope: ['punctuation'], settings: { foreground: theme.muted } },
    ]

    return registerDynamicTheme(themeId, 'Termspace Dynamic', theme.base, colors, tokenColors)
  }, [settings.theme, extensionsReady])

  const FILE_LOAD_TIMEOUT_MS = 15000

  useEffect(() => {
    const controller = new AbortController()
    setLoadError(null)
    setShowPreview(false)

    const loadFile = async () => {
      if (!editorPane?.activeFilePath) {
        setFileContent('')
        setOriginalFileContent('')
        setIsDirty(false)
        return
      }

      if (isBinaryFile(editorPane.activeFilePath)) {
        setFileContent('')
        setOriginalFileContent('')
        setIsDirty(false)
        return
      }

      setIsLoading(true)
      try {
        const content = await Promise.race([
          readTextFileContent(editorPane.activeFilePath),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Timed out reading file')), FILE_LOAD_TIMEOUT_MS)
          ),
        ])
        if (controller.signal.aborted) return
        setFileContent(content)

        if (editorPane.diffViewEnabled) {
          try {
            const relativePath = editorPane.activeFilePath.replace(editorPane.rootPath + '/', '')
            const origContent = await invoke('get_git_file_content', { path: editorPane.rootPath, file_path: relativePath }) as string
            if (!controller.signal.aborted) {
              setOriginalFileContent(origContent)
            }
          } catch (e) {
            if (!controller.signal.aborted) {
              setOriginalFileContent('')
            }
          }
        }

        setIsDirty(false)
      } catch (err: any) {
        if (controller.signal.aborted) return
        console.error('Failed to read file:', err)
        setLoadError(err?.message || String(err))
        addToast(`Failed to read file: ${err?.message || err}`, 'error')
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    loadFile()
    return () => controller.abort()
  }, [editorPane?.activeFilePath, editorPane?.diffViewEnabled, editorPane?.rootPath, addToast])

  const handleFileSelect = (path: string) => {
    if (isDirty) {
      setShowConfirmDiscard({ path })
      return
    }
    updateEditorPaneFile(workspaceId, editorPaneId, path)
  }

  const confirmDiscard = () => {
    if (showConfirmDiscard) {
      updateEditorPaneFile(workspaceId, editorPaneId, showConfirmDiscard.path)
      setShowConfirmDiscard(null)
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setFileContent(value)
      setIsDirty(true)
    }
  }

  const handleSave = useCallback(async () => {
    if (!editorPane?.activeFilePath || isBinaryFile(editorPane.activeFilePath)) return
    
    try {
      await writeTextFileContent(editorPane.activeFilePath, fileContent)
      setIsDirty(false)
      addToast('File saved', 'success')
      refreshGitStatus(workspaceId, editorPane.rootPath || "")
    } catch (err) {
      console.error('Failed to save file:', err)
      addToast('Failed to save file', 'error')
    }
  }, [editorPane?.activeFilePath, editorPane?.rootPath, fileContent, addToast, refreshGitStatus, workspaceId])

  useEffect(() => {
    const onSaveAll = () => {
      if (isDirty) handleSave()
    }
    window.addEventListener('save-all-editors', onSaveAll)
    return () => window.removeEventListener('save-all-editors', onSaveAll)
  }, [isDirty, handleSave])

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor
    
    // Only update the model text if it differs from the disk content.
    // This preserves the undo stack if the user switches tabs back and forth.
    if (editor.getValue() !== fileContent) {
      editor.setValue(fileContent);
    }
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA, () => {
      selectAllInEditor();
    });

    // macOS native menus swallow Cmd+Z / Cmd+Shift+Z and convert them to native undo/redo actions.
    // Monaco doesn't always catch these natively, so we intercept the beforeinput events.
    const handleBeforeInput = (e: Event) => {
      const inputEvent = e as InputEvent;
      if (inputEvent.inputType === 'historyUndo') {
        e.preventDefault();
        editor.trigger('keyboard', 'undo', null);
      } else if (inputEvent.inputType === 'historyRedo') {
        e.preventDefault();
        editor.trigger('keyboard', 'redo', null);
      }
    };
    
    const container = typeof editor.getContainerDOMNode === 'function' 
      ? editor.getContainerDOMNode() 
      : (typeof editor.getDomNode === 'function' ? editor.getDomNode() : null);
      
    if (container) {
      container.addEventListener('beforeinput', handleBeforeInput);
    }

    editor.onDidChangeCursorPosition((e: any) => {
      const line = e.position.lineNumber;
      
      if (blameTimeoutRef.current) {
        clearTimeout(blameTimeoutRef.current);
      }
      
      if (blameDecorationRef.current) {
        blameDecorationRef.current.set([]);
      }

      blameTimeoutRef.current = setTimeout(async () => {
        try {
          const state = useAppStore.getState();
          const panes = state.editorPanesByTab[workspaceId];
          const pane = panes?.find((p: any) => p.id === editorPaneId);
          const activePath = pane?.activeFilePath || editorPane?.activeFilePath;
          
          if (!activePath) return;

          const blame = await invoke('get_git_blame', { 
            path: activePath, 
            line 
          });
          
          if (blame) {
            if (!blameDecorationRef.current) {
              blameDecorationRef.current = editor.createDecorationsCollection();
            }
            blameDecorationRef.current.set([{
              range: new monaco.Range(line, 1, line, 1),
              options: {
                isWholeLine: true,
                after: {
                  content: `    ${(blame as any).author}, ${new Date(Number((blame as any).time) * 1000).toLocaleDateString()} • ${(blame as any).message}`,
                  color: '#6e7681',
                  margin: '20px'
                }
              }
            }]);
          }
        } catch (err) {
          // Ignore error
        }
      }, 300);
    });

    // Handle jumpToLine on initial mount
    if (editorPane?.jumpToLine) {
      const line = editorPane.jumpToLine
      editor.revealLineInCenter(line)
      editor.setSelection({
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 1
      })
      editor.focus()
      
      // Clear jumpToLine after jump to avoid re-jumping
      setTimeout(() => {
        updateEditorPaneLayout(workspaceId, editorPaneId, { jumpToLine: null })
      }, 100)
    }
  }

  useEffect(() => {
    if (!settings.autosave || !isDirty || !editorPane?.activeFilePath) return
    const timer = setTimeout(() => handleSave(), 1000)
    return () => clearTimeout(timer)
  }, [isDirty, settings.autosave, editorPane?.activeFilePath, handleSave])

  // Async initialization of VS Code extension host
  useEffect(() => {
    let cancelled = false
    initializeExtensions()
      .then(() => { if (!cancelled) setExtensionsReady(true) })
      .catch((err) => {
        console.error('[editor] extension host init failed, continuing without extensions:', err)
        if (!cancelled) setExtensionsReady(true)
      })
    return () => { cancelled = true }
  }, [])

  if (!editorPane) return null

  if (!extensionsReady) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--editor-muted)', fontSize: 13, background: 'var(--editor-bg)' }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--editor-dim)', borderTopColor: 'var(--editor-accent)', marginRight: 12, animation: 'spin 1s linear infinite' }} /> Initializing editor...
      </div>
    )
  }

  const fileName = editorPane.activeFilePath ? editorPane.activeFilePath.split('/').pop() : 'No file open'
  const filePathParts = editorPane.activeFilePath ? editorPane.activeFilePath.replace(editorPane.rootPath || '', '').split('/').filter(Boolean) : []
  const isBinary = editorPane.activeFilePath ? isBinaryFile(editorPane.activeFilePath) : false

  return (
    <div 
      className="editor-pane-shell"
      style={{
        display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
        backgroundColor: 'var(--editor-bg)', borderRadius: 8, overflow: 'hidden',
        position: 'relative', border: '1px solid',
        borderColor: isActive ? 'var(--editor-accent)' : 'var(--editor-border)',
        boxShadow: isActive ? '0 0 0 1px color-mix(in srgb, var(--editor-accent) 45%, transparent), 0 18px 45px rgba(0,0,0,0.28)' : '0 10px 28px rgba(0,0,0,0.18)',
        zIndex: isActive ? 10 : 0,
        minWidth: 0, minHeight: 0
      }}
    >
      {/* Header Area */}
      <div style={{
        display: 'flex', flexDirection: 'column', backgroundColor: 'var(--editor-panel)',
        borderBottom: '1px solid var(--editor-border)', userSelect: 'none', flexShrink: 0
      }}>
        {/* Top Row: Breadcrumbs and Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 32 }}>
           {/* Breadcrumbs */}
           {filePathParts.length > 0 ? (
             <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--editor-dim)', overflow: 'hidden', flex: 1 }}>
               <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>root</span>
               {filePathParts.map((part, idx) => (
                 <React.Fragment key={idx}>
                   <ChevronRight size={10} style={{ flexShrink: 0, opacity: 0.5 }} />
                   <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150, color: idx === filePathParts.length - 1 ? 'var(--editor-text)' : undefined }}>{part}</span>
                 </React.Fragment>
               ))}
             </div>
           ) : (
             <div style={{ fontSize: 11, color: 'var(--editor-dim)', fontStyle: 'italic', flex: 1 }}>No file selected</div>
           )}

           {/* Command Center Search Bar */}
           <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
             <div 
               onClick={() => useAppStore.getState().setShowCommandPalette(true)}
               style={{
                 width: '100%', maxWidth: 300, height: 24, borderRadius: 6,
                 backgroundColor: 'var(--editor-bg)', border: '1px solid var(--editor-border)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                 color: 'var(--editor-muted)', fontSize: 11, cursor: 'pointer', transition: 'all 0.2s',
               }}
               onMouseEnter={(e) => {
                 e.currentTarget.style.backgroundColor = 'var(--editor-surface)'
                 e.currentTarget.style.color = 'var(--editor-text)'
               }}
               onMouseLeave={(e) => {
                 e.currentTarget.style.backgroundColor = 'var(--editor-bg)'
                 e.currentTarget.style.color = 'var(--editor-muted)'
               }}
             >
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
               <span>Search {(editorPane.rootPath || '').split('/').pop()}</span>
             </div>
           </div>

           {/* Actions */}
           <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
             <button 
               className="editor-icon-button"
               onClick={handleSave}
               disabled={!isDirty || !editorPane.activeFilePath || isBinary}
               style={{
                 padding: 4, borderRadius: 6, cursor: (isDirty && !isBinary) ? 'pointer' : 'not-allowed',
                 color: (isDirty && !isBinary) ? 'var(--editor-accent)' : 'var(--editor-dim)',
                 opacity: (isDirty && !isBinary) ? 1 : 0.3
               }}
               title="Save (Cmd+S)"
               onMouseEnter={(e) => {
                 if (isDirty && !isBinary) e.currentTarget.style.backgroundColor = 'color-mix(in srgb, var(--editor-accent) 16%, transparent)'
               }}
               onMouseLeave={(e) => {
                 e.currentTarget.style.backgroundColor = 'transparent'
               }}
             >
               <Save size={14} />
             </button>

              {editorPane.activeFilePath?.toLowerCase().endsWith('.md') && (
                <button 
                  className="editor-icon-button"
                  onClick={() => setShowPreview(!showPreview)} 
                  style={{
                   padding: 4, borderRadius: 4, cursor: 'pointer',
                   color: showPreview ? 'var(--editor-accent)' : 'var(--editor-dim)'
                 }}
                 title={showPreview ? "Hide Preview" : "Show Preview"}
                 onMouseEnter={(e) => {
                   e.currentTarget.style.color = 'var(--editor-text)'
                   e.currentTarget.style.backgroundColor = 'var(--editor-surface-hover)'
                 }}
                 onMouseLeave={(e) => {
                   e.currentTarget.style.color = showPreview ? 'var(--editor-accent)' : 'var(--editor-dim)'
                   e.currentTarget.style.backgroundColor = 'transparent'
                 }}
               >
                 {showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
               </button>
             )}

             {/* Split Buttons */}
             <button 
               className="editor-icon-button"
               onClick={() => splitEditor(workspaceId, editorPaneId, 'horizontal')} 
               style={{
                 padding: 4, borderRadius: 4, cursor: 'pointer',
                 color: 'var(--editor-dim)'
               }}
               title="Split Right"
               onMouseEnter={(e) => {
                 e.currentTarget.style.color = 'var(--editor-text)'
                 e.currentTarget.style.backgroundColor = 'var(--editor-surface-hover)'
               }}
               onMouseLeave={(e) => {
                 e.currentTarget.style.color = 'var(--editor-dim)'
                 e.currentTarget.style.backgroundColor = 'transparent'
               }}
             >
               <Columns size={14} />
             </button>
             <button 
               className="editor-icon-button"
               onClick={() => splitEditor(workspaceId, editorPaneId, 'vertical')} 
               style={{
                 padding: 4, borderRadius: 4, cursor: 'pointer',
                 color: 'var(--editor-dim)'
               }}
               title="Split Down"
               onMouseEnter={(e) => {
                 e.currentTarget.style.color = 'var(--editor-text)'
                 e.currentTarget.style.backgroundColor = 'var(--editor-surface-hover)'
               }}
               onMouseLeave={(e) => {
                 e.currentTarget.style.color = 'var(--editor-dim)'
                 e.currentTarget.style.backgroundColor = 'transparent'
               }}
             >
               <Rows size={14} />
             </button>

             <button 
               className="editor-icon-button"
               onClick={() => removeEditorPane(workspaceId, editorPaneId)}
               style={{
                 padding: 4, borderRadius: 4, cursor: 'pointer',
                 color: 'var(--editor-dim)'
               }}
               title="Close Editor Pane"
               onMouseEnter={(e) => {
                 e.currentTarget.style.color = 'var(--editor-text)'
                 e.currentTarget.style.backgroundColor = 'var(--editor-surface-hover)'
               }}
               onMouseLeave={(e) => {
                 e.currentTarget.style.color = 'var(--editor-dim)'
                 e.currentTarget.style.backgroundColor = 'transparent'
               }}
             >
               <X size={14} />
             </button>
           </div>
        </div>

        {/* Tab Bar UI - Below Breadcrumbs */}
        <div
          style={{
            display: 'flex', height: 36, alignItems: 'center',
            backgroundColor: 'var(--editor-panel)',
            borderTop: '1px solid var(--editor-border)',
            overflow: 'hidden'
          }}
        >
          {/* Scrollable tab list */}
          <div
            className="no-scrollbar"
            style={{ display: 'flex', flex: 1, overflowX: 'auto', height: '100%', alignItems: 'center', padding: '0 8px', gap: 4 }}
          >
          {editorPane.openFiles.map(path => {
            const relativePath = path.replace(editorPane.rootPath + '/', '')
            const status = gitStatus ? gitStatus[relativePath] : undefined
            const statusColor = status === 'M' ? '#FBC02D' : status === 'A' ? '#4CAF50' : status === '??' ? '#2196F3' : undefined

            return (
              <div 
                key={path}
                className={`editor-tab ${editorPane.activeFilePath === path ? 'active' : ''}`}
                onClick={() => {
                  if (editorPane.diffViewEnabled) updateEditorPaneLayout(workspaceId, editorPaneId, { diffViewEnabled: false });
                  handleFileSelect(path);
                }}
                style={{
                  display: 'flex', alignItems: 'center', height: '100%', gap: 6,
                  backgroundColor: editorPane.activeFilePath === path ? 'var(--bg-terminal)' : 'transparent',
                  color: statusColor || (editorPane.activeFilePath === path ? 'var(--editor-text)' : 'var(--editor-muted)'),
                  borderTop: `2px solid ${editorPane.activeFilePath === path ? 'var(--editor-accent)' : 'transparent'}`,
                  cursor: 'pointer',
                  borderRight: '1px solid var(--editor-border)',
                  opacity: editorPane.activeFilePath === path ? 1 : 0.6,
                  transition: 'background-color 0.2s, opacity 0.2s',
                  padding: '0 12px',
                  minWidth: 120,
                  maxWidth: 200,
                  position: 'relative'
                }}
              >
                <FileCode 
                  size={12} 
                  style={{ color: statusColor || (editorPane.activeFilePath === path ? 'var(--editor-accent)' : 'var(--editor-dim)') }} 
                />
                <span style={{ 
                  fontSize: 11, 
                  whiteSpace: 'nowrap',
                  fontStyle: (isDirty && editorPane.activeFilePath === path) ? 'italic' : 'normal',
                  fontWeight: (isDirty && editorPane.activeFilePath === path) ? 'bold' : 'normal',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {path.split('/').pop()}
                  {isDirty && editorPane.activeFilePath === path && <span style={{ color: 'var(--editor-accent)', marginLeft: 2 }}>*</span>}
                </span>
                {status && (
                  <span style={{ fontSize: '9px', fontWeight: 'bold', opacity: 0.8 }}>{status === '??' ? 'U' : status}</span>
                )}
                {isDirty && editorPane.activeFilePath === path && (
                  <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--editor-accent)', flexShrink: 0, marginLeft: 4 }} />
                )}
                <button 
                  className="editor-icon-button editor-tab-close"
                  onClick={(e) => { e.stopPropagation(); closeEditorFile(workspaceId, editorPaneId, path); }}
                  style={{
                    padding: 2, borderRadius: 4, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--editor-muted)'
                  }}
                  title="Close Tab"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--editor-surface-hover)'
                    e.currentTarget.style.color = 'var(--editor-text)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                    e.currentTarget.style.color = 'var(--editor-muted)'
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
          {editorPane.openFiles.length === 0 && (
            <div style={{ padding: '0 12px', fontSize: 11, color: 'var(--editor-dim)', fontStyle: 'italic' }}>No open files</div>
          )}
          </div>

          {/* Save / Save All / Auto Save */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
            borderLeft: '1px solid var(--editor-border)', flexShrink: 0, height: '100%'
          }}>
            <button
              className="editor-icon-button"
              onClick={handleSave}
              disabled={!isDirty || !editorPane.activeFilePath || isBinary}
              title="Save (Cmd+S)"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                borderRadius: 5, border: '1px solid',
                borderColor: (isDirty && !isBinary) ? 'var(--editor-accent)' : 'var(--editor-border)',
                background: 'none', cursor: (isDirty && !isBinary) ? 'pointer' : 'not-allowed',
                color: (isDirty && !isBinary) ? 'var(--editor-accent)' : 'var(--editor-dim)',
                fontSize: 11, opacity: (isDirty && !isBinary) ? 1 : 0.4,
                transition: 'all 0.2s'
              }}
            >
              <Save size={11} />
              Save
            </button>

            <button
              className="editor-icon-button"
              onClick={() => window.dispatchEvent(new Event('save-all-editors'))}
              title="Save All"
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
                borderRadius: 5, border: '1px solid var(--editor-border)',
                background: 'none', cursor: 'pointer',
                color: 'var(--editor-dim)', fontSize: 11,
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--editor-text)'
                e.currentTarget.style.borderColor = 'var(--editor-muted)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--editor-dim)'
                e.currentTarget.style.borderColor = 'var(--editor-border)'
              }}
            >
              <Save size={11} />
              Save All
            </button>

            {/* Auto Save toggle */}
            <div
              onClick={() => updateSettings({ autosave: !settings.autosave })}
              title={settings.autosave ? 'Auto Save: On' : 'Auto Save: Off'}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px',
                borderRadius: 5, border: '1px solid var(--editor-border)',
                cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s',
                color: settings.autosave ? 'var(--editor-accent)' : 'var(--editor-dim)', fontSize: 11
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--editor-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--editor-border)')}
            >
              {/* pill toggle */}
              <div style={{
                width: 24, height: 13, borderRadius: 7, position: 'relative', flexShrink: 0,
                backgroundColor: settings.autosave ? 'var(--editor-accent)' : 'rgba(255,255,255,0.15)',
                transition: 'background-color 0.2s'
              }}>
                <div style={{
                  position: 'absolute', top: 2, left: settings.autosave ? 13 : 2,
                  width: 9, height: 9, borderRadius: '50%',
                  backgroundColor: '#fff', transition: 'left 0.2s'
                }} />
              </div>
              Auto Save
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Split */}
      <div 
        style={{ flex: 1, overflow: 'hidden', backgroundColor: 'var(--editor-bg)' }} 
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Group orientation="horizontal">
          <Panel 
            defaultSize={editorPane.fileTreeWidth || 20} 
            minSize={10} 
            style={{ height: '100%', position: 'relative' }}
            onResize={(size) => {
              const currentSize = editorPane.fileTreeWidth || 20
              if (Math.abs(currentSize - Number(size)) > 0.1) {
                if ((window as any).editorResizeTimeout) clearTimeout((window as any).editorResizeTimeout)
                ;(window as any).editorResizeTimeout = setTimeout(() => {
                  updateEditorPaneLayout(workspaceId, editorPaneId, { fileTreeWidth: Number(size) })
                }, 100)
              }
            }}
          >
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ 
                width: 48, backgroundColor: 'var(--editor-panel)', borderRight: '1px solid var(--editor-border)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16, gap: 16
              }}>
                <button 
                  className={`editor-icon-button editor-activity-button ${(!editorPane.activeSidebarTab || editorPane.activeSidebarTab === 'explorer') ? 'active' : ''}`}
                  onClick={() => updateEditorPaneLayout(workspaceId, editorPaneId, { activeSidebarTab: 'explorer' })}
                  style={{ width: 36, height: 36, borderRadius: 6, cursor: 'pointer', color: (!editorPane.activeSidebarTab || editorPane.activeSidebarTab === 'explorer') ? 'var(--editor-text)' : 'var(--editor-dim)' }}
                >
                  <Folder size={20} />
                </button>
                <button 
                  className={`editor-icon-button editor-activity-button ${editorPane.activeSidebarTab === 'search' ? 'active' : ''}`}
                  onClick={() => updateEditorPaneLayout(workspaceId, editorPaneId, { activeSidebarTab: 'search' })}
                  style={{ width: 36, height: 36, borderRadius: 6, cursor: 'pointer', color: editorPane.activeSidebarTab === 'search' ? 'var(--editor-text)' : 'var(--editor-dim)' }}
                >
                  <Search size={20} />
                </button>
                <button 
                  className={`editor-icon-button editor-activity-button ${editorPane.activeSidebarTab === 'git' ? 'active' : ''}`}
                  onClick={() => updateEditorPaneLayout(workspaceId, editorPaneId, { activeSidebarTab: 'git' })}
                  style={{ width: 36, height: 36, borderRadius: 6, cursor: 'pointer', color: editorPane.activeSidebarTab === 'git' ? 'var(--editor-text)' : 'var(--editor-dim)' }}
                >
                  <GitBranch size={20} />
                </button>
              </div>
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {editorPane.activeSidebarTab === 'git' ? (
                  <GitPanel workspaceId={workspaceId} editorPaneId={editorPaneId} rootPath={editorPane.rootPath || ''} onFileSelect={handleFileSelect} />
                ) : editorPane.activeSidebarTab === 'search' ? (
                  <SearchPanel workspaceId={workspaceId} editorPaneId={editorPaneId} rootPath={editorPane.rootPath || ''} onFileSelect={handleFileSelect} />
                ) : (
                  <FileTree workspaceId={workspaceId} rootPath={editorPane.rootPath || ''} onFileSelect={(path) => {
                    if (editorPane.diffViewEnabled) updateEditorPaneLayout(workspaceId, editorPaneId, { diffViewEnabled: false });
                    handleFileSelect(path);
                  }} />
                )}
              </div>
            </div>
          </Panel>
          
          <Separator 
            style={{ 
              width: 1, 
              backgroundColor: 'var(--editor-border)', 
              zIndex: 10,
              cursor: 'col-resize',
              transition: 'all 0.2s'
            }} 
          />
          
          <Panel defaultSize={80} minSize={30} style={{ height: '100%', position: 'relative', backgroundColor: 'var(--editor-bg)' }}>
            {editorPane.activeFilePath ? (
              isLoading ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--editor-muted)', fontSize: 13, background: 'var(--editor-bg)' }}>
                  <div style={{ 
                    width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--editor-dim)', 
                    borderTopColor: 'var(--editor-accent)', marginRight: 12, animation: 'spin 1s linear infinite' 
                  }} /> Loading file content...
                </div>
              ) : loadError ? (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', color: 'var(--editor-muted)',
                  backgroundColor: 'var(--editor-bg)', padding: 32, textAlign: 'center'
                }}>
                  <FileCode size={48} style={{ marginBottom: 16, opacity: 0.3, color: '#ef4444' }} />
                  <p style={{ fontSize: 14, color: 'var(--editor-text)' }}>Failed to load file</p>
                  <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8, fontFamily: 'var(--terminal-font-family, monospace)', backgroundColor: 'var(--editor-surface)', padding: '4px 8px', borderRadius: 4 }}>{loadError}</p>
                </div>
              ) : isImageFile(editorPane.activeFilePath) ? (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', 
                  justifyContent: 'center', padding: 32, background: 'var(--editor-surface)',
                  overflow: 'auto', backgroundImage: 'repeating-conic-gradient(color-mix(in srgb, var(--editor-surface) 72%, black) 0% 25%, var(--editor-surface-hover) 0% 50%)',
                  backgroundSize: '20px 20px'
                }}>
                  <img 
                    src={convertFileSrc(editorPane.activeFilePath!)} 
                    alt="Preview" 
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}
                  />
                </div>
              ) : isBinary ? (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', color: 'var(--editor-muted)',
                  backgroundColor: 'var(--editor-bg)'
                }}>
                   <ImageIcon size={48} style={{ marginBottom: 16, opacity: 0.2 }} />
                   <p style={{ fontSize: 14 }}>The file is not displayed in the editor because it is either binary or uses an unsupported text encoding.</p>
                   <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8, fontFamily: 'var(--terminal-font-family, monospace)', backgroundColor: 'var(--editor-surface)', padding: '4px 8px', borderRadius: 4 }}>{fileName}</p>
                </div>
              ) : editorPane.diffViewEnabled ? (
                <DiffEditor
                  height="100%"
                  original={originalFileContent.replace(/\r\n/g, '\n')}
                  modified={fileContent.replace(/\r\n/g, '\n')}
                  language={getLanguageFromPath(editorPane.activeFilePath)}
                  theme="termspace-dynamic"
                  onMount={(editor, m) => {
                    const modifiedEditor = editor.getModifiedEditor();
                    handleEditorDidMount(modifiedEditor, m);
                    modifiedEditor.onDidChangeModelContent(() => {
                      handleEditorChange(modifiedEditor.getValue());
                    });
                  }}
                  options={{
                    minimap: { enabled: settings.minimapEnabled ?? false },
                    fontSize: settings.fontSize || 14,
                    lineHeight: settings.lineHeight ? Math.round(settings.fontSize * settings.lineHeight) : undefined,
                    fontFamily: settings.terminalFontFamily || '"JetBrains Mono", "Fira Code", Menlo, monospace',
                    fontLigatures: true,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    padding: { top: 16, bottom: 16 },
                    renderSideBySide: true,
                    readOnly: false,
                    hideUnchangedRegions: { enabled: false },
                    ignoreTrimWhitespace: true,
                  }}
                />
              ) : (editorPane.activeFilePath && editorPane.activeFilePath.toLowerCase().endsWith('.md') && showPreview) ? (
                <MarkdownPreview content={fileContent} workspaceId={workspaceId} editorPaneId={editorPaneId} />
              ) : (
                <Editor
                  height="100%"
                  path={editorPane.activeFilePath}
                  language={getLanguageFromPath(editorPane.activeFilePath)}
                  theme="termspace-dynamic"
                  onChange={handleEditorChange}
                  onMount={handleEditorDidMount}
                  options={{
                    minimap: { enabled: settings.minimapEnabled ?? false },
                    fontSize: settings.fontSize || 14,
                    lineHeight: settings.lineHeight ? Math.round(settings.fontSize * settings.lineHeight) : undefined,
                    fontFamily: settings.terminalFontFamily || '"JetBrains Mono", "Fira Code", Menlo, monospace',
                    fontLigatures: true,
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    padding: { top: 16, bottom: 16 },
                    renderLineHighlight: 'all',
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                  }}
                />
              )
            ) : (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', color: 'var(--editor-dim)',
                backgroundColor: 'var(--editor-bg)', opacity: 0.75
              }}>
                <FileCode size={48} style={{ marginBottom: 16, opacity: 0.5 }} />
                <p style={{ fontSize: 14 }}>Select a file to start editing</p>
              </div>
            )}
          </Panel>
        </Group>
      </div>

      {showConfirmDiscard && (
        <ConfirmModal
          title="Discard Changes"
          message={`Are you sure you want to discard unsaved changes to ${fileName}?`}
          confirmText="Discard"
          cancelText="Cancel"
          isDestructive={true}
          onConfirm={confirmDiscard}
          onCancel={() => setShowConfirmDiscard(null)}
        />
      )}
    </div>
  )
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'html':
      return 'html'
    case 'css':
      return 'css'
    case 'md':
      return 'markdown'
    case 'rs':
      return 'rust'
    case 'php':
      return 'php'
    case 'py':
      return 'python'
    case 'go':
      return 'go'
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
      return 'cpp'
    case 'java':
      return 'java'
    case 'sh':
    case 'bash':
      return 'shell'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'xml':
      return 'xml'
    case 'sql':
      return 'sql'
    default:
      return 'plaintext'
  }
}
