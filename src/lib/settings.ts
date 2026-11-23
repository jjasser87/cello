/**
 * App-level prefs (separate from workspace persistence).
 *
 * Shape:
 * ```json
 * {
 *   "rscriptPath": "/usr/local/bin/Rscript" | null,
 *   "helperDock": "left" | "right" | "top" | "bottom"
 * }
 * ```
 *
 * `rscriptPath` is an optional override for the machine Rscript binary.
 * Cleared / null → kernel host auto-discovers via PATH (and CELLO_RSCRIPT).
 *
 * `helperDock` places the ribbon panel cluster relative to the main editor
 * (default: right — helpers expand rightward).
 */
import type { HelperDock } from '../types'

export type { HelperDock }

const KEY = 'cello.settings.v0'

export type AppSettings = {
  rscriptPath: string | null
  helperDock: HelperDock
}

const DEFAULTS: AppSettings = {
  rscriptPath: null,
  helperDock: 'right',
}

const DOCKS: readonly HelperDock[] = ['right', 'left', 'top', 'bottom']

export function isHelperDock(value: unknown): value is HelperDock {
  return typeof value === 'string' && (DOCKS as readonly string[]).includes(value)
}

function normalizeRscriptPath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeHelperDock(value: unknown): HelperDock {
  return isHelperDock(value) ? value : DEFAULTS.helperDock
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      rscriptPath: normalizeRscriptPath(parsed.rscriptPath),
      helperDock: normalizeHelperDock(parsed.helperDock),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const next: AppSettings = {
    rscriptPath:
      partial.rscriptPath === undefined
        ? current.rscriptPath
        : normalizeRscriptPath(partial.rscriptPath),
    helperDock:
      partial.helperDock === undefined
        ? current.helperDock
        : normalizeHelperDock(partial.helperDock),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode — still return the in-memory prefs */
  }
  return next
}
