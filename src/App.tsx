import { useEffect } from 'react'
import { CellEditor } from './components/CellEditor'
import { SidePanel } from './components/panels/SidePanel'
import { useWorkspace } from './hooks/useWorkspace'

export default function App() {
  const api = useWorkspace()
  const { state, activeCell, runCell } = api
  const activeIndex = state.cells.findIndex((cell) => cell.id === activeCell.id)
  const index = Math.max(0, activeIndex)
  const total = state.cells.length

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
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
      runCell()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCell])

  return (
    <div className="app-shell">
      <div className={`workspace ${state.sidePanelOpen ? 'panel-open' : 'panel-collapsed'}`}>
        {/*
          Action chrome sits above the cell. The ribbon is height-pinned to the
          code-area frame only (see CellEditor workspace-lane), not this row.
        */}
        <div className="workspace-cluster">
          <div className="main-actions" role="toolbar" aria-label="Workspace and cell actions">
            <div className="action-group">
              <button type="button" onClick={api.runAll} title="Run all cells in order">
                Run all
              </button>
              <button type="button" onClick={api.resetKernel}>
                Reset
              </button>
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([api.exportScript()], { type: 'text/plain' })
                  const url = URL.createObjectURL(blob)
                  const anchor = document.createElement('a')
                  anchor.href = url
                  anchor.download = state.scriptPath
                  anchor.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Export
              </button>
            </div>
            <div className="action-group">
              <button
                type="button"
                onClick={() => api.moveCell(activeCell.id, -1)}
                disabled={index === 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => api.moveCell(activeCell.id, 1)}
                disabled={index === total - 1}
                title="Move down"
              >
                ↓
              </button>
              <button type="button" onClick={() => api.addCell(activeCell.id)} title="Add cell below">
                + Cell
              </button>
              <button
                type="button"
                onClick={() => api.deleteCell(activeCell.id)}
                title="Delete cell"
              >
                Delete
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => api.runCell(activeCell.id)}
                title="Run cell (⌘/Ctrl+Enter)"
              >
                Run
              </button>
            </div>
          </div>

          <CellEditor
            cell={activeCell}
            index={index}
            onChange={api.updateActiveCode}
            onRename={(name) => api.renameCell(activeCell.id, name)}
            onRun={() => api.runCell(activeCell.id)}
            sidePanel={<SidePanel api={api} />}
          />
        </div>
      </div>
    </div>
  )
}
