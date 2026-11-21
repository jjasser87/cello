import type { KernelLanguage, WorkspaceState } from '../types'
import {
  hydratePersistedCell,
  parseProject,
  serializeProject,
  stringifyProject,
  type CelloProjectV1,
  type PersistedCell,
} from './projectFile'

export type { PersistedCell, CelloProjectV1 }
export { hydratePersistedCell }

const KEY_V1 = 'cello.workspace.v1'
const KEY_V0 = 'cello.workspace.v0'

/**
 * Workspace persistence (localStorage) — same schema as the downloadable
 * `.cello` project file (`cello-project` v1).
 *
 * Runtime artifacts (plots, tables, env, history, console) are not stored.
 * Plain script export (`⇩` / `cellsToScript`) stays code-only with cell markers.
 */
export function saveWorkspace(state: WorkspaceState): { ok: true } | { ok: false; error: string } {
  const project = serializeProject(state)
  try {
    localStorage.setItem(KEY_V1, stringifyProject(project))
    // Drop legacy key once v1 is written successfully.
    try {
      localStorage.removeItem(KEY_V0)
    } catch {
      /* ignore */
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message || 'localStorage write failed' }
  }
}

export function loadWorkspace(): CelloProjectV1 | null {
  try {
    const v1 = localStorage.getItem(KEY_V1)
    if (v1) {
      const parsed = parseProject(v1)
      return parsed.ok ? parsed.project : null
    }
    const v0 = localStorage.getItem(KEY_V0)
    if (!v0) return null
    const parsed = parseProject(v0)
    return parsed.ok ? parsed.project : null
  } catch {
    return null
  }
}

export function exportProjectJson(state: WorkspaceState): string {
  return stringifyProject(serializeProject(state))
}

export type LoadedWorkspaceFields = {
  cells: PersistedCell[]
  activeCellId: string
  activePanel: WorkspaceState['activePanel']
  scriptPath: string
  language: KernelLanguage
  files: WorkspaceState['files']
  meta: WorkspaceState['meta']
}
