import { readTextFile, writeTextFile, readDir } from '@tauri-apps/plugin-fs'

export interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileNode[]
}

export async function readTextFileContent(path: string): Promise<string> {
  return await readTextFile(path)
}

export async function writeTextFileContent(path: string, content: string): Promise<void> {
  await writeTextFile(path, content)
}

export function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1
    if (!a.isDirectory && b.isDirectory) return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })
}

/**
 * Joins subPath onto workspacePath for the multi-agent launch flow. Returns
 * null (reject the slot) rather than silently clamping, if subPath contains
 * a `.` or `..` segment after normalization — an agent slot must not be able
 * to point its cwd outside the workspace root via a crafted subpath.
 */
export function resolveWorkspaceSubPath(workspacePath: string, subPath?: string): string | null {
  const trimmed = (subPath ?? '').trim()
  if (!trimmed) return workspacePath
  const stripped = trimmed.replace(/^\/+/, '')
  if (!stripped) return workspacePath
  const segments = stripped.split('/')
  if (segments.some((segment) => segment === '..' || segment === '.')) return null
  return `${workspacePath}/${stripped}`
}

export async function fetchDirectoryTree(path: string): Promise<FileNode[]> {
  try {
    const entries = await readDir(path)
    const nodes: FileNode[] = []
    
    for (const entry of entries) {
      // Skip hidden files/directories like .git or .DS_Store
      if (entry.name.startsWith('.')) continue
      
      const fullPath = `${path}/${entry.name}`
      
      if (entry.isDirectory) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          isDirectory: true,
          children: [] // Children are loaded lazily
        })
      } else {
        nodes.push({
          name: entry.name,
          path: fullPath,
          isDirectory: false
        })
      }
    }
    
    return sortNodes(nodes)
  } catch (error) {
    console.error(`Error reading directory ${path}:`, error)
    return []
  }
}
