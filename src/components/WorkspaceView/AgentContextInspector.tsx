export function AgentContextInspector({ cwd }: { cwd: string }) {
  return <aside className="agent-studio__inspector" aria-label="Context inspector"><h3>Context bundle</h3><p><strong>Workspace</strong><br />{cwd || 'No workspace selected'}</p><p><strong>Auto-applied</strong><br />Nearest AGENTS.md → root AGENTS.md → CLAUDE.md</p><p><strong>Safety</strong><br />.env files, private keys, and outside-workspace symlinks are excluded.</p><p><strong>Access</strong><br />Advisory access — your provider controls remain visible and explicit.</p></aside>
}
