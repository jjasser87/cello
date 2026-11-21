import type { ExplanationComment, KernelLanguage, WorkspaceState } from '../types'
import { ensureExplanation } from './explanation'
import { cellsToScript } from './script'

const KEY = 'cello.workspace.v0'

export type PersistedCell = {
  id: string
  name: string
  code: string
  explanation?: string
  comments?: ExplanationComment[]
}

/**
 * Workspace persistence (localStorage).
 *
 * Payload shape:
 * ```json
 * {
 *   "script": "<plain-text # %% / // %% export>",
 *   "cells": [{ "id", "name", "code", "explanation", "comments" }],
 *   "activeCellId", "activePanel", "scriptPath", "language"
 * }
 * ```
 *
 * Script export (`⇩` / `cellsToScript`) stays code-only with cell markers.
 * Explanations + comments live in the `cells[]` JSON above (not embedded in
 * the `.R` / `.js` file). Re-importing a plain script seeds empty explanation
 * templates; a full workspace restore from localStorage keeps docs + comments.
 */
export function saveWorkspace(state: WorkspaceState): { ok: true } | { ok: false; error: string } {
  const payload = {
    script: cellsToScript(state.cells, state.language),
    cells: state.cells.map(({ id, name, code, explanation, comments }) => ({
      id,
      name,
      code,
      explanation: explanation ?? ensureExplanation(''),
      comments: comments ?? [],
    })),
    activeCellId: state.activeCellId,
    activePanel: state.activePanel,
    scriptPath: state.scriptPath,
    language: state.language,
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
  cells: PersistedCell[]
  activeCellId: string
  activePanel: WorkspaceState['activePanel']
  scriptPath: string
  language: KernelLanguage
}> | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as ReturnType<typeof loadWorkspace>
  } catch {
    return null
  }
}

/** Normalize a persisted / partial cell into a full Cell-shaped seed. */
export function hydratePersistedCell(cell: PersistedCell): {
  id: string
  name: string
  code: string
  explanation: string
  comments: ExplanationComment[]
  status: 'idle'
} {
  return {
    id: cell.id,
    name: cell.name,
    code: cell.code,
    explanation: ensureExplanation(cell.explanation),
    comments: Array.isArray(cell.comments) ? cell.comments : [],
    status: 'idle',
  }
}
