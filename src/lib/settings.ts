/**
 * App-level prefs (separate from workspace persistence).
 *
 * Shape:
 * ```json
 * { "rscriptPath": "/usr/local/bin/Rscript" | null }
 * ```
 *
 * `rscriptPath` is an optional override for the machine Rscript binary.
 * Cleared / null → kernel host auto-discovers via PATH (and CELLO_RSCRIPT).
 */
const KEY = 'cello.settings.v0'

export type AppSettings = {
  rscriptPath: string | null
}

const DEFAULTS: AppSettings = {
  rscriptPath: null,
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const path =
      typeof parsed.rscriptPath === 'string' && parsed.rscriptPath.trim()
        ? parsed.rscriptPath.trim()
        : null
    return { rscriptPath: path }
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
        : typeof partial.rscriptPath === 'string' && partial.rscriptPath.trim()
          ? partial.rscriptPath.trim()
          : null,
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode — still return the in-memory prefs */
  }
  return next
}
