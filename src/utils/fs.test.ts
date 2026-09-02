import { describe, it, expect } from 'vitest'
import { resolveWorkspaceSubPath } from './fs'

describe('resolveWorkspaceSubPath', () => {
  it('returns the workspace path unchanged when subPath is undefined or blank', () => {
    expect(resolveWorkspaceSubPath('/repo', undefined)).toBe('/repo')
    expect(resolveWorkspaceSubPath('/repo', '')).toBe('/repo')
    expect(resolveWorkspaceSubPath('/repo', '   ')).toBe('/repo')
  })

  it('joins a plain relative subPath onto the workspace path', () => {
    expect(resolveWorkspaceSubPath('/repo', 'backend')).toBe('/repo/backend')
    expect(resolveWorkspaceSubPath('/repo', 'backend/api')).toBe('/repo/backend/api')
  })

  it('strips a leading slash before joining', () => {
    expect(resolveWorkspaceSubPath('/repo', '/backend')).toBe('/repo/backend')
  })

  it('rejects a subPath containing a .. segment', () => {
    expect(resolveWorkspaceSubPath('/repo', '../etc')).toBeNull()
    expect(resolveWorkspaceSubPath('/repo', 'backend/../../etc')).toBeNull()
  })

  it('rejects a subPath containing a bare . segment', () => {
    expect(resolveWorkspaceSubPath('/repo', './backend')).toBeNull()
  })
})
