/**
 * Monaco VS Code Service Override Setup
 *
 * This module must be imported BEFORE any Monaco editor component is rendered.
 * It applies VS Code service overrides to the local monaco-editor instance
 * and configures @monaco-editor/react's loader to use it instead of the CDN.
 *
 * Import in EditorPane.tsx as:
 *   import '../vscode-extensions/setup'
 */

// Side-effect imports: monkey-patches monaco-editor's standalone services
// with VS Code-compatible versions (TextMate grammars, themes, configuration, etc.)
import '@codingame/monaco-vscode-editor-api'

// @monaco-editor/react loader — configure to use the local instance
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

// Point @monaco-editor/react at our local Monaco (VS Code services applied)
loader.config({ monaco })
