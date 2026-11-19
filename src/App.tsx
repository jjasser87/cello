import { useEffect, useState } from 'react'
import { CellEditor } from './components/CellEditor'
import { SidePanel } from './components/panels/SidePanel'
import { TopNav } from './components/TopNav'
import { useWorkspace } from './hooks/useWorkspace'

export default function App() {
  const api = useWorkspace()
  const { state, activeCell, runCell } = api
  const [navExpanded, setNavExpanded] = useState(true)
  const activeIndex = state.cells.findIndex((cell) => cell.id === activeCell.id)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        runCell()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCell])

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden />
      <TopNav
        active={state.activePanel}
        expanded={navExpanded}
        onSelect={api.setPanel}
        onToggleExpand={() => setNavExpanded((value) => !value)}
      />

      <div className={`workspace ${navExpanded ? 'nav-open' : ''}`}>
        <main className="main-window">
          <div className="main-meta">
            <div>
              <div className="eyebrow">Main window</div>
              <h1>{activeCell.name}</h1>
            </div>
            <div className="main-actions">
              <button type="button" onClick={api.runAll} title="Run all cells in order">
                Run all
              </button>
              <button type="button" onClick={api.resetKernel}>
                Reset kernel
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
                Export .js
              </button>
            </div>
          </div>

          <CellEditor
            cell={activeCell}
            index={Math.max(0, activeIndex)}
            total={state.cells.length}
            onChange={api.updateActiveCode}
            onRename={(name) => api.renameCell(activeCell.id, name)}
            onRun={() => api.runCell(activeCell.id)}
            onAdd={() => api.addCell(activeCell.id)}
            onDelete={() => api.deleteCell(activeCell.id)}
            onMove={(direction) => api.moveCell(activeCell.id, direction)}
          />
        </main>

        <SidePanel api={api} />
      </div>
    </div>
  )
}
