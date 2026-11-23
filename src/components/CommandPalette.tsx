import { useEffect, useMemo, useRef, useState } from 'react'
import type { HelperDock, PanelId } from '../types'

const HELPER_DOCK_OPTIONS: { id: HelperDock; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
]

export type CommandId =
  | `panel:${PanelId}`
  | 'prev-cell'
  | 'next-cell'
  | 'toggle-explain'
  | 'run'
  | 'run-all'
  | 'reset'
  | 'toggle-language'
  | 'new-project'
  | 'save-project'
  | 'open-project'
  | 'settings'

export interface CommandItem {
  id: CommandId
  label: string
  hint?: string
  group: 'Navigate' | 'Panels' | 'Kernel' | 'Project' | 'Settings'
}

const PANEL_COMMANDS: { id: PanelId; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'plot', label: 'Plot' },
  { id: 'data', label: 'Data' },
  { id: 'env', label: 'Env' },
  { id: 'structure', label: 'Flow' },
  { id: 'cells', label: 'Cells' },
  { id: 'explain', label: 'Explain' },
  { id: 'history', label: 'History' },
  { id: 'files', label: 'Files' },
  { id: 'ai', label: 'Agent' },
]

function buildCommands(language: 'r' | 'javascript'): CommandItem[] {
  const panels: CommandItem[] = PANEL_COMMANDS.map((panel) => ({
    id: `panel:${panel.id}`,
    label: `Go to ${panel.label}`,
    hint: 'Ribbon',
    group: 'Panels',
  }))

  return [
    {
      id: 'prev-cell',
      label: 'Previous cell',
      hint: 'Alt+↑',
      group: 'Navigate',
    },
    {
      id: 'next-cell',
      label: 'Next cell',
      hint: 'Alt+↓',
      group: 'Navigate',
    },
    {
      id: 'toggle-explain',
      label: 'Explain cell',
      hint: 'Purpose doc',
      group: 'Navigate',
    },
    ...panels,
    {
      id: 'run',
      label: 'Run cell',
      hint: '⌘/Ctrl+Enter',
      group: 'Kernel',
    },
    {
      id: 'run-all',
      label: 'Run all cells',
      group: 'Kernel',
    },
    {
      id: 'reset',
      label: 'Reset kernel',
      group: 'Kernel',
    },
    {
      id: 'toggle-language',
      label: language === 'r' ? 'Switch to JavaScript' : 'Switch to R',
      hint: language === 'r' ? 'R → JS' : 'JS → R',
      group: 'Kernel',
    },
    {
      id: 'new-project',
      label: 'New project',
      hint: 'Starter cells + file tree',
      group: 'Project',
    },
    {
      id: 'save-project',
      label: 'Save project…',
      hint: '.cello',
      group: 'Project',
    },
    {
      id: 'open-project',
      label: 'Open project…',
      hint: '.cello',
      group: 'Project',
    },
    {
      id: 'settings',
      label: 'Settings…',
      hint: 'R path · helper dock',
      group: 'Settings',
    },
  ]
}

interface CommandPaletteProps {
  language: 'r' | 'javascript'
  rscriptPath: string | null
  rscriptResolved: string | null
  kernelAvailable: boolean
  kernelMessage: string | null
  helperDock: HelperDock
  onClose: () => void
  onRun: (id: CommandId) => void
  onSetRscriptPath: (path: string | null) => void | Promise<void>
  onSetHelperDock: (dock: HelperDock) => void
}

export function CommandPalette({
  language,
  rscriptPath,
  rscriptResolved,
  kernelAvailable,
  kernelMessage,
  helperDock,
  onClose,
  onRun,
  onSetRscriptPath,
  onSetHelperDock,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [view, setView] = useState<'commands' | 'settings'>('commands')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useMemo(() => buildCommands(language), [language])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((item) => {
      const hay = `${item.label} ${item.hint ?? ''} ${item.group}`.toLowerCase()
      return hay.includes(q)
    })
  }, [commands, query])

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (view !== 'commands') return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, view, filtered.length])

  const runActive = () => {
    const item = filtered[activeIndex]
    if (!item) return
    if (item.id === 'settings') {
      setView('settings')
      return
    }
    onRun(item.id)
  }

  const groups = (['Navigate', 'Panels', 'Kernel', 'Project', 'Settings'] as const)
    .map((group) => ({
      group,
      items: filtered
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.group === group),
    }))
    .filter((entry) => entry.items.length > 0)

  return (
    <div
      className="palette-root"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={view === 'settings' ? 'Settings' : 'Command palette'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (view === 'settings') {
              setView('commands')
              return
            }
            onClose()
            return
          }
          if (view === 'settings') return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length))
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((prev) =>
              filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length,
            )
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            runActive()
          }
        }}
      >
        {view === 'commands' ? (
          <>
            <div className="palette-search">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActiveIndex(0)
                }}
                placeholder="Type a command…"
                aria-label="Filter commands"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="palette-kbd">esc</kbd>
            </div>
            <div className="palette-list" ref={listRef} role="listbox" aria-label="Commands">
              {groups.length === 0 ? (
                <p className="palette-empty">No matching commands</p>
              ) : (
                groups.map(({ group, items }) => (
                  <div key={group} className="palette-group" role="group" aria-label={group}>
                    <div className="palette-group-label">{group}</div>
                    {items.map(({ item, index }) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        data-index={index}
                        aria-selected={index === activeIndex}
                        className={`palette-item ${index === activeIndex ? 'is-active' : ''}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => {
                          if (item.id === 'settings') {
                            setView('settings')
                            return
                          }
                          onRun(item.id)
                        }}
                      >
                        <span className="palette-item-label">{item.label}</span>
                        {item.hint ? <span className="palette-item-hint">{item.hint}</span> : null}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
            <p className="palette-foot">
              ↑↓ navigate · Enter run · Esc close · ⌘/Ctrl+Shift+P
            </p>
          </>
        ) : (
          <SettingsPanel
            language={language}
            rscriptPath={rscriptPath}
            rscriptResolved={rscriptResolved}
            kernelAvailable={kernelAvailable}
            kernelMessage={kernelMessage}
            helperDock={helperDock}
            onBack={() => setView('commands')}
            onClose={onClose}
            onToggleLanguage={() => onRun('toggle-language')}
            onSetRscriptPath={onSetRscriptPath}
            onSetHelperDock={onSetHelperDock}
          />
        )}
      </div>
    </div>
  )
}

function SettingsPanel({
  language,
  rscriptPath,
  rscriptResolved,
  kernelAvailable,
  kernelMessage,
  helperDock,
  onBack,
  onClose,
  onToggleLanguage,
  onSetRscriptPath,
  onSetHelperDock,
}: {
  language: 'r' | 'javascript'
  rscriptPath: string | null
  rscriptResolved: string | null
  kernelAvailable: boolean
  kernelMessage: string | null
  helperDock: HelperDock
  onBack: () => void
  onClose: () => void
  onToggleLanguage: () => void
  onSetRscriptPath: (path: string | null) => void | Promise<void>
  onSetHelperDock: (dock: HelperDock) => void
}) {
  const [draft, setDraft] = useState(rscriptPath ?? '')
  const [busy, setBusy] = useState(false)

  const apply = async (next: string | null) => {
    setBusy(true)
    try {
      await onSetRscriptPath(next)
    } finally {
      setBusy(false)
    }
  }

  const statusText = kernelAvailable
    ? `Using ${rscriptResolved ?? 'Rscript'}`
    : kernelMessage ?? 'R kernel unavailable'

  return (
    <div className="palette-settings">
      <div className="palette-settings-header">
        <button type="button" className="palette-back" onClick={onBack} aria-label="Back to commands">
          ←
        </button>
        <h2>Settings</h2>
        <button type="button" className="palette-back" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="palette-settings-body">
        <label className="palette-pref">
          <span className="palette-pref-label">Kernel language</span>
          <button type="button" className="palette-pref-action" onClick={onToggleLanguage}>
            {language === 'r' ? 'R' : 'JavaScript'} · switch
          </button>
        </label>

        <label className="palette-pref">
          <span className="palette-pref-label" id="settings-helper-dock-label">
            Helper dock
          </span>
          <select
            className="palette-pref-select"
            value={helperDock}
            aria-labelledby="settings-helper-dock-label"
            onChange={(event) => onSetHelperDock(event.target.value as HelperDock)}
          >
            {HELPER_DOCK_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="palette-settings-note muted small">
          Ribbon panels (Plot, Console, Data, …) sit on this side of the editor. Default is left.
        </p>

        <div className="palette-pref-stack">
          <span className="palette-pref-label" id="settings-rscript-label">
            R path (Rscript)
          </span>
          <input
            className="palette-pref-input"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Auto-discover from PATH"
            spellCheck={false}
            autoComplete="off"
            aria-labelledby="settings-rscript-label"
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void apply(draft.trim() || null)
              }
            }}
          />
          <div className="palette-pref-row">
            <button
              type="button"
              className="palette-pref-action"
              disabled={busy}
              onClick={() => void apply(draft.trim() || null)}
            >
              Apply
            </button>
            <button
              type="button"
              className="palette-pref-action"
              disabled={busy || (!rscriptPath && !draft.trim())}
              onClick={() => {
                setDraft('')
                void apply(null)
              }}
            >
              Clear
            </button>
          </div>
          <p className={`palette-settings-status muted small ${kernelAvailable ? '' : 'is-warn'}`}>
            {statusText}
          </p>
        </div>

        <p className="palette-settings-note muted small">
          Desktop packaging will reuse this override. Leave empty to find Rscript on PATH (or set{' '}
          <code>CELLO_RSCRIPT</code>).
        </p>
      </div>
    </div>
  )
}
