import type { WorkspaceState } from '../types'
import { cellsToScript } from './script'

const KEY = 'cello.workspace.v0'

export function saveWorkspace(state: WorkspaceState): { ok: true } | { ok: false; error: string } {
  const payload = {
    script: cellsToScript(state.cells),
    cells: state.cells.map(({ id, name, code }) => ({ id, name, code })),
    activeCellId: state.activeCellId,
    activePanel: state.activePanel,
    scriptPath: state.scriptPath,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(payload))
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message || 'localStorage write failed' }
  }
}

export function loadWorkspace(): Partial<{
  cells: { id: string; name: string; code: string }[]
  activeCellId: string
  activePanel: WorkspaceState['activePanel']
  scriptPath: string
}> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as ReturnType<typeof loadWorkspace>
  } catch {
    return null
  }
}
