import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CellEditor } from './components/CellEditor'
import { CommandPalette, type CommandId } from './components/CommandPalette'
import { SidePanel } from './components/panels/SidePanel'
import { useDesktopWindowFit } from './hooks/useDesktopWindowFit'
import { useWorkspace } from './hooks/useWorkspace'
import { exportProjectJson } from './lib/storage'
import { projectFileName } from './lib/projectFile'
import type { PanelId } from './types'

export default function App() {
  const api = useWorkspace()
  const { state, activeCell, runCell } = api
  const activeIndex = state.cells.findIndex((cell) => cell.id === activeCell.id)
  const index = Math.max(0, activeIndex)
  const total = state.cells.length
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openProjectInputRef = useRef<HTMLInputElement>(null)

  // Electron: hug the editor cluster; grow/shrink when ribbon panels toggle.
  // Editor content overflow scrolls inside the cell — do not remasure on typing.
  useDesktopWindowFit({
    sidePanelOpen: state.sidePanelOpen,
    activePanel: state.activePanel,
    helperDock: state.helperDock,
    cellId: activeCell.id,
  })

  const closePalette = useCallback(() => setPaletteOpen(false), [])

  const goPrevCell = useCallback(() => {
    if (index <= 0) return
    api.selectCell(state.cells[index - 1].id)
  }, [api, index, state.cells])

  const goNextCell = useCallback(() => {
    if (index >= total - 1) return
    api.selectCell(state.cells[index + 1].id)
  }, [api, index, total, state.cells])

  const saveProject = useCallback(() => {
    if (state.projectRoot && state.filesSource === 'disk') {
      void api.saveFolderProject().then((result) => {
        if (!result.ok) {
          window.alert(`Could not save folder project: ${result.error}`)
        }
      })
      return
    }
    const json = exportProjectJson(state)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = projectFileName(state.meta.name)
    anchor.click()
    URL.revokeObjectURL(url)
  }, [state, api])

  const pickOpenProject = useCallback(() => {
    openProjectInputRef.current?.click()
  }, [])

  const pickOpenFolder = useCallback(() => {
    void api.openFolder().then((result) => {
      if (!result.ok) {
        if (result.cancelled) return
        window.alert(`Could not open folder: ${result.error}`)
      }
    })
  }, [api])

  const onOpenProjectFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : ''
        const result = api.openProjectJson(text)
        if (!result.ok) {
          console.warn('Cello open project failed:', result.error)
          window.alert(`Could not open project: ${result.error}`)
        }
      }
      reader.readAsText(file)
    },
    [api],
  )

  const runPaletteCommand = useCallback(
    (id: CommandId) => {
      if (id.startsWith('panel:')) {
        const panel = id.slice('panel:'.length) as PanelId
        api.setPanel(panel)
        setPaletteOpen(false)
        return
      }
      if (id === 'prev-cell') {
        goPrevCell()
        setPaletteOpen(false)
        return
      }
      if (id === 'next-cell') {
        goNextCell()
        setPaletteOpen(false)
        return
      }
      if (id === 'toggle-explain') {
        api.toggleSidePanel('explain')
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
      if (id === 'new-project') {
        api.newProject()
        setPaletteOpen(false)
        return
      }
      if (id === 'save-project') {
        setPaletteOpen(false)
        saveProject()
        return
      }
      if (id === 'open-project') {
        setPaletteOpen(false)
        pickOpenProject()
        return
      }
      if (id === 'open-folder') {
        setPaletteOpen(false)
        pickOpenFolder()
        return
      }
    },
    [
      api,
      activeCell.id,
      state.language,
      goPrevCell,
      goNextCell,
      saveProject,
      pickOpenProject,
      pickOpenFolder,
    ],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.shiftKey && (event.key === 'p' || event.key === 'P')) {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }

      // ⌘/Ctrl+S — save folder project (cello.json + .cello/) or download .cello.
      if (mod && !event.shiftKey && (event.key === 's' || event.key === 'S')) {
        event.preventDefault()
        saveProject()
        return
      }

      // Alt+↑ / Alt+↓ — jump cells (also handled inside the textarea).
      if (event.altKey && !mod && !paletteOpen) {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          goPrevCell()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          goNextCell()
          return
        }
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
  }, [runCell, goPrevCell, goNextCell, paletteOpen, saveProject])

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
      {/*
        Electron title-bar drag strip. Height is env(titlebar-area-height) when
        the desktop shell uses a hidden title bar + overlay; 0px in the browser.
      */}
      <div className="window-chrome-drag" aria-hidden="true" />
      <input
        ref={openProjectInputRef}
        type="file"
        accept=".cello,application/json"
        className="visually-hidden"
        aria-hidden
        tabIndex={-1}
        onChange={onOpenProjectFile}
      />
      <div
        className={`workspace ${state.sidePanelOpen ? 'panel-open' : 'panel-collapsed'}`}
        data-dock={state.helperDock}
      >
        <div className="workspace-cluster">
          <CellEditor
            cell={activeCell}
            index={index}
            total={total}
            language={state.language}
            rLintEnabled={state.rLintEnabled}
            env={state.env}
            kernelHint={
              state.language === 'r'
                ? state.kernelStatus.available
                  ? `R ${state.kernelStatus.version ?? ''}`.trim()
                  : 'R unavailable'
                : 'JS'
            }
            kernelDetail={
              state.language === 'r' && !state.kernelStatus.available
                ? (state.kernelStatus.message ?? undefined)
                : undefined
            }
            onChange={api.updateActiveCode}
            onRename={(name) => api.renameCell(activeCell.id, name)}
            onRun={() => void api.runCell(activeCell.id)}
            onPrevCell={goPrevCell}
            onNextCell={goNextCell}
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
                  className={`tool-icon${state.sidePanelOpen && state.activePanel === 'explain' ? ' is-active' : ''}`}
                  onClick={() => api.toggleSidePanel('explain')}
                  title="Explain cell (purpose doc)"
                  aria-label="Explain cell"
                  aria-pressed={state.sidePanelOpen && state.activePanel === 'explain'}
                >
                  ¶
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
          rscriptPath={state.kernelStatus.rscriptOverride ?? null}
          rscriptResolved={state.kernelStatus.rscriptPath ?? null}
          kernelAvailable={state.kernelStatus.available}
          kernelMessage={state.kernelStatus.message}
          helperDock={state.helperDock}
          rLintEnabled={state.rLintEnabled}
          onClose={closePalette}
          onRun={runPaletteCommand}
          onSetRscriptPath={api.setRscriptPath}
          onSetHelperDock={api.setHelperDock}
          onSetRLintEnabled={api.setRLintEnabled}
        />
      ) : null}
    </div>
  )
}
