import { useCallback, useEffect, useState } from 'react'
import { CellEditor } from './components/CellEditor'
import { CommandPalette, type CommandId } from './components/CommandPalette'
import { SidePanel } from './components/panels/SidePanel'
import { useWorkspace } from './hooks/useWorkspace'
import type { PanelId } from './types'

export default function App() {
  const api = useWorkspace()
  const { state, activeCell, runCell } = api
  const activeIndex = state.cells.findIndex((cell) => cell.id === activeCell.id)
  const index = Math.max(0, activeIndex)
  const total = state.cells.length
  const [paletteOpen, setPaletteOpen] = useState(false)

  const closePalette = useCallback(() => setPaletteOpen(false), [])

  const runPaletteCommand = useCallback(
    (id: CommandId) => {
      if (id.startsWith('panel:')) {
        const panel = id.slice('panel:'.length) as PanelId
        api.setPanel(panel)
        setPaletteOpen(false)
        return
      }
      if (id === 'run') {
        setPaletteOpen(false)
        void api.runCell(activeCell.id)
        return
      }
      if (id === 'run-all') {
        setPaletteOpen(false)
        void api.runAll()
        return
      }
      if (id === 'reset') {
        setPaletteOpen(false)
        void api.resetKernel()
        return
      }
      if (id === 'toggle-language') {
        api.setLanguage(state.language === 'r' ? 'javascript' : 'r')
        setPaletteOpen(false)
        return
      }
    },
    [api, activeCell.id, state.language],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.shiftKey && (event.key === 'p' || event.key === 'P')) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      if (!(mod) || event.key !== 'Enter') return
      // CellEditor already handles this shortcut inside the textarea.
      const target = event.target
      if (
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLInputElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      void runCell()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCell])

  const exportScript = () => {
    const blob = new Blob([api.exportScript()], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = state.scriptPath
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app-shell">
      <div className={`workspace ${state.sidePanelOpen ? 'panel-open' : 'panel-collapsed'}`}>
        <div className="workspace-cluster">
          <CellEditor
            cell={activeCell}
            index={index}
            language={state.language}
            kernelHint={
              state.language === 'r'
                ? state.kernelStatus.available
                  ? `R ${state.kernelStatus.version ?? ''}`.trim()
                  : state.kernelStatus.message ?? 'R unavailable'
                : 'in-browser JS'
            }
            onChange={api.updateActiveCode}
            onRename={(name) => api.renameCell(activeCell.id, name)}
            onRun={() => void api.runCell(activeCell.id)}
            toolbar={
              <div className="cell-toolbar" role="toolbar" aria-label="Cell actions">
                <label className="tool-lang" title="Cell language / kernel">
                  <span className="visually-hidden">Language</span>
                  <select
                    value={state.language}
                    onChange={(event) =>
                      api.setLanguage(event.target.value === 'javascript' ? 'javascript' : 'r')
                    }
                    aria-label="Kernel language"
                  >
                    <option value="r">R</option>
                    <option value="javascript">JS</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="tool-icon primary"
                  onClick={() => void api.runCell(activeCell.id)}
                  title="Run cell (⌘/Ctrl+Enter)"
                  aria-label="Run cell"
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={() => void api.runAll()}
                  title="Run all cells in order"
                  aria-label="Run all"
                >
                  ⏭
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={() => api.moveCell(activeCell.id, -1)}
                  disabled={index === 0}
                  title="Move up"
                  aria-label="Move cell up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={() => api.moveCell(activeCell.id, 1)}
                  disabled={index === total - 1}
                  title="Move down"
                  aria-label="Move cell down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={() => api.addCell(activeCell.id)}
                  title="Add cell below"
                  aria-label="Add cell"
                >
                  +
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={() => api.deleteCell(activeCell.id)}
                  title="Delete cell"
                  aria-label="Delete cell"
                >
                  ×
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={() => void api.resetKernel()}
                  title="Reset kernel"
                  aria-label="Reset kernel"
                >
                  ↺
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={() => setPaletteOpen(true)}
                  title="Command palette (⌘/Ctrl+Shift+P)"
                  aria-label="Open command palette"
                >
                  ⌘
                </button>
                <button
                  type="button"
                  className="tool-icon"
                  onClick={exportScript}
                  title="Export script"
                  aria-label="Export script"
                >
                  ⇩
                </button>
              </div>
            }
            sidePanel={<SidePanel api={api} />}
          />
        </div>
      </div>

      {paletteOpen ? (
        <CommandPalette
          language={state.language}
          onClose={closePalette}
          onRun={runPaletteCommand}
        />
      ) : null}
    </div>
  )
}
