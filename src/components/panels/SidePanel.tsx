import { useLayoutEffect, useRef, useState } from 'react'
import { FlowGraphView } from '../FlowGraph'
import { diffLines } from '../../lib/diff'
import type { WorkspaceApi } from '../../hooks/useWorkspace'
import type { PanelId, ProjectFile } from '../../types'

const RIBBON_ITEMS: { id: PanelId; label: string; short: string }[] = [
  { id: 'cells', label: 'Cells', short: 'Ce' },
  { id: 'history', label: 'History', short: 'Hi' },
  { id: 'plot', label: 'Plot', short: 'Pl' },
  { id: 'files', label: 'Files', short: 'Fi' },
  { id: 'env', label: 'Env', short: 'En' },
  { id: 'data', label: 'Data', short: 'Da' },
  { id: 'structure', label: 'Flow', short: 'Fl' },
  { id: 'console', label: 'Console', short: 'Co' },
  { id: 'ai', label: 'Agent', short: 'Ag' },
]

interface SidePanelProps {
  api: WorkspaceApi
}

export function SidePanel({ api }: SidePanelProps) {
  const { state, toggleSidePanel, collapseSidePanel } = api
  const open = state.sidePanelOpen

  const isFlow = open && state.activePanel === 'structure'

  return (
    <aside
      className={`side-shell ${open ? 'is-open' : 'is-collapsed'}${isFlow ? ' is-flow' : ''}`}
      data-panel={open ? state.activePanel : undefined}
      aria-label={open ? `${state.activePanel} panel` : 'Panel ribbon'}
    >
      {/*
        Order: panel slot, then ribbon. Collapsed slot width is 0 so the ribbon
        sits against the cell; when open the panel grows between cell and ribbon
        and the ribbon stays at the far/right edge of the expanded cluster.
      */}
      <div
        className="side-panel-slot"
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="side-panel">
          <PanelHeader panel={state.activePanel} onCollapse={collapseSidePanel} />
          <div className={`side-panel-body${isFlow ? ' is-flow' : ''}`}>
            {state.activePanel === 'cells' && <CellsPanel api={api} />}
            {state.activePanel === 'history' && <HistoryPanel api={api} />}
            {state.activePanel === 'plot' && <PlotPanel api={api} />}
            {state.activePanel === 'files' && <FilesPanel api={api} />}
            {state.activePanel === 'env' && <EnvPanel api={api} />}
            {state.activePanel === 'data' && <DataPanel api={api} />}
            {state.activePanel === 'structure' && <StructurePanel api={api} />}
            {state.activePanel === 'console' && <ConsolePanel api={api} />}
            {state.activePanel === 'ai' && <AiPanel api={api} />}
          </div>
        </div>
      </div>

      <nav className="side-ribbon" aria-label="Panel options">
        {RIBBON_ITEMS.map((item) => {
          const active = open && state.activePanel === item.id
          const isPrimary = item.id === 'cells'
          return (
            <button
              key={item.id}
              type="button"
              className={`ribbon-item ${active ? 'is-active' : ''} ${isPrimary ? 'is-primary' : ''}`}
              aria-pressed={active}
              title={isPrimary ? `${item.label} — start here` : item.label}
              onClick={() => toggleSidePanel(item.id)}
            >
              <span className="ribbon-short">{item.short}</span>
              <span className="ribbon-label">{item.label}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

function PanelHeader({ panel, onCollapse }: { panel: PanelId; onCollapse: () => void }) {
  const titles: Record<PanelId, { title: string; blurb: string }> = {
    cells: { title: 'Cells', blurb: 'Order determines script flow.' },
    history: { title: 'History', blurb: 'Runs for the selected cell.' },
    plot: { title: 'Plot', blurb: 'Plot from the selected cell.' },
    files: { title: 'Files', blurb: 'Project tree.' },
    env: { title: 'Environment', blurb: 'Bindings in the kernel.' },
    data: { title: 'Data', blurb: 'Table from the selected cell.' },
    structure: { title: 'Script flow', blurb: 'Auto graph of how cells connect.' },
    console: { title: 'Console', blurb: 'Output for the selected cell.' },
    ai: { title: 'Agent', blurb: 'Suggests — never silent rewrites.' },
  }
  const copy = titles[panel]
  return (
    <div className="panel-header">
      <div>
        <h2>{copy.title}</h2>
        <p>{copy.blurb}</p>
      </div>
      <button type="button" className="collapse-btn" onClick={onCollapse} title="Collapse panel">
        Collapse
      </button>
    </div>
  )
}

function CellsPanel({ api }: SidePanelProps) {
  const { state, selectCell, renameCell, moveCell, addCell, deleteCell } = api
  return (
    <div className="stack-list">
      {state.cells.map((cell, index) => (
        <div
          key={cell.id}
          className={`stack-item ${cell.id === state.activeCellId ? 'is-active' : ''}`}
        >
          <button type="button" className="stack-main" onClick={() => selectCell(cell.id)}>
            <span className="mono">#{index + 1}</span>
            <input
              value={cell.name}
              onClick={(event) => event.stopPropagation()}
              onFocus={() => selectCell(cell.id)}
              onChange={(event) => renameCell(cell.id, event.target.value)}
            />
            <span className={`status-dot status-${cell.status}`} />
          </button>
          <div className="stack-ops">
            <button type="button" onClick={() => moveCell(cell.id, -1)} disabled={index === 0}>
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveCell(cell.id, 1)}
              disabled={index === state.cells.length - 1}
            >
              ↓
            </button>
            <button type="button" onClick={() => deleteCell(cell.id)} title="Delete cell">
              ×
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="ghost-block" onClick={() => addCell(state.activeCellId)}>
        + Add cell
      </button>
    </div>
  )
}

function HistoryPanel({ api }: SidePanelProps) {
  const { state, setHistoryIndex, restoreHistoryCode } = api
  const cellHistory = state.history.filter((entry) => entry.cellId === state.activeCellId)
  if (cellHistory.length === 0) {
    return <EmptyState text="No history for this cell yet. Run it to start building history." />
  }
  const current =
    state.historyIndex >= 0 ? state.history[state.historyIndex] : undefined
  let localIndex = cellHistory.length - 1
  if (current && current.cellId === state.activeCellId) {
    const match = cellHistory.findIndex((entry) => entry.id === current.id)
    if (match >= 0) localIndex = match
  }
  const entry = cellHistory[localIndex]
  const lines = diffLines(entry.previousCode, entry.code)
  const goToLocal = (nextLocal: number) => {
    const target = cellHistory[nextLocal]
    if (!target) return
    const globalIndex = state.history.findIndex((item) => item.id === target.id)
    if (globalIndex >= 0) setHistoryIndex(globalIndex)
  }

  return (
    <div className="history-panel">
      <div className="history-nav">
        <button
          type="button"
          onClick={() => goToLocal(localIndex - 1)}
          disabled={localIndex <= 0}
          aria-label="Previous version"
        >
          ←
        </button>
        <div>
          <strong>{entry.cellName}</strong>
          <div className="muted">
            {localIndex + 1} / {cellHistory.length} ·{' '}
            {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
        </div>
        <button
          type="button"
          onClick={() => goToLocal(localIndex + 1)}
          disabled={localIndex >= cellHistory.length - 1}
          aria-label="Next version"
        >
          →
        </button>
      </div>

      <div className="diff-grid">
        <div className="diff-pane">
          <div className="diff-label">Previous</div>
          <pre>
            {lines.map((line, i) =>
              line.type === 'add' ? null : (
                <div key={`l-${i}`} className={line.type === 'remove' ? 'diff-remove' : ''}>
                  {line.text || ' '}
                </div>
              ),
            )}
          </pre>
        </div>
        <div className="diff-pane">
          <div className="diff-label">Current run</div>
          <pre>
            {lines.map((line, i) =>
              line.type === 'remove' ? null : (
                <div key={`r-${i}`} className={line.type === 'add' ? 'diff-add' : ''}>
                  {line.text || ' '}
                </div>
              ),
            )}
          </pre>
        </div>
      </div>

      {entry.outputText ? <pre className="output-block">{entry.outputText}</pre> : null}
      {entry.error ? <div className="cell-error">Error: {entry.error}</div> : null}

      <button
        type="button"
        className="primary wide"
        onClick={restoreHistoryCode}
        disabled={!state.cells.some((cell) => cell.id === entry.cellId)}
        title={
          state.cells.some((cell) => cell.id === entry.cellId)
            ? 'Restore this code into the cell'
            : 'Cell no longer exists'
        }
      >
        Restore this code into the cell
      </button>
    </div>
  )
}

function PlotPanel({ api }: SidePanelProps) {
  const { state } = api
  const cellPlots = state.plots.filter((item) => item.cellId === state.activeCellId)
  const plot =
    cellPlots.find((item) => item.id === state.activePlotId) ??
    cellPlots[cellPlots.length - 1]

  if (!plot) {
    return (
      <EmptyState text="No plot for this cell. Use plot() / ggplot(), or cello.plot({ labels, values }) — this panel opens automatically." />
    )
  }

  return (
    <div className="plot-panel">
      <div className="plot-title-row">
        <h3>{plot.title}</h3>
        <span className="muted">{plot.kind}</span>
      </div>
      {plot.kind === 'image' && plot.imageData ? (
        <img className="plot-image" src={plot.imageData} alt={plot.title} />
      ) : plot.kind === 'line' ? (
        <LineChart plot={plot} />
      ) : (
        <BarChart plot={plot} />
      )}
      {cellPlots.length > 1 ? (
        <ul className="plot-list">
          {cellPlots
            .slice()
            .reverse()
            .map((item) => (
              <li key={item.id} className={item.id === plot.id ? 'is-active' : ''}>
                {item.title}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  )
}

function BarChart({
  plot,
}: {
  plot: { title: string; labels: string[]; values: number[] }
}) {
  const max = Math.max(0, ...plot.values)
  const min = Math.min(0, ...plot.values)
  const span = max - min || 1
  const zeroRatio = (max - 0) / span

  return (
    <div className="bar-chart has-baseline" role="img" aria-label={plot.title}>
      {plot.labels.map((label, index) => {
        const value = plot.values[index] ?? 0
        const height = `${(Math.abs(value) / span) * 100}%`
        const isNegative = value < 0
        return (
          <div key={`${label}-${index}`} className="bar-col">
            <div className="bar-track">
              <div className="bar-zero" style={{ top: `${zeroRatio * 100}%` }} />
              <div
                className={`bar ${isNegative ? 'is-negative' : 'is-positive'}`}
                style={
                  isNegative
                    ? { top: `${zeroRatio * 100}%`, height }
                    : { bottom: `${(0 - min) / span * 100}%`, height }
                }
                title={`${label}: ${value}`}
              />
            </div>
            <span>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function LineChart({
  plot,
}: {
  plot: { title: string; labels: string[]; values: number[] }
}) {
  const width = 320
  const height = 180
  const pad = 16
  const max = Math.max(0, ...plot.values)
  const min = Math.min(0, ...plot.values)
  const span = max - min || 1
  const points = plot.values.map((value, index) => {
    const x =
      plot.values.length === 1
        ? width / 2
        : pad + (index / (plot.values.length - 1)) * (width - pad * 2)
    const y = pad + ((max - value) / span) * (height - pad * 2)
    return `${x},${y}`
  })

  return (
    <div className="line-chart" role="img" aria-label={plot.title}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="180">
        <line
          x1={pad}
          x2={width - pad}
          y1={pad + ((max - 0) / span) * (height - pad * 2)}
          y2={pad + ((max - 0) / span) * (height - pad * 2)}
          className="chart-baseline"
        />
        <polyline points={points.join(' ')} className="chart-line" fill="none" />
        {plot.values.map((value, index) => {
          const [x, y] = points[index].split(',').map(Number)
          return <circle key={index} cx={x} cy={y} r="3.5" className="chart-point">
            <title>{`${plot.labels[index]}: ${value}`}</title>
          </circle>
        })}
      </svg>
      <div className="line-labels">
        {plot.labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

function FilesPanel({ api }: SidePanelProps) {
  return (
    <div className="file-tree">
      <p className="muted small">
        Active script: <code>{api.state.scriptPath}</code> (<code>// %%</code> cells)
      </p>
      <FileNode nodes={api.state.files} depth={0} />
    </div>
  )
}

function FileNode({ nodes, depth }: { nodes: ProjectFile[]; depth: number }) {
  return (
    <ul style={{ paddingLeft: depth ? 14 : 0 }}>
      {nodes.map((node) => (
        <li key={node.id}>
          <span className="file-row">
            <span aria-hidden>{node.kind === 'folder' ? '▸' : '·'}</span>
            {node.name}
          </span>
          {node.children ? <FileNode nodes={node.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  )
}

function EnvPanel({ api }: SidePanelProps) {
  const { env } = api.state
  if (env.length === 0) {
    return <EmptyState text="Environment is empty. Run cells to populate bindings." />
  }
  return (
    <table className="data-table env-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Kind</th>
          <th>Preview</th>
        </tr>
      </thead>
      <tbody>
        {env.map((binding) => (
          <tr key={binding.name}>
            <td className="mono">{binding.name}</td>
            <td>{binding.kind}</td>
            <td className="mono">{binding.preview}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DataPanel({ api }: SidePanelProps) {
  const { state } = api
  const cellTables = state.tables.filter((item) => item.cellId === state.activeCellId)
  const table =
    cellTables.find((item) => item.id === state.activeTableId) ??
    cellTables[cellTables.length - 1]

  if (!table) {
    return <EmptyState text="No table for this cell. Use cello.table(rows, 'name')." />
  }

  return (
    <div className="data-panel">
      <div className="plot-title-row">
        <h3>{table.name}</h3>
        <span className="muted">
          {table.rows.length} rows · {table.columns.length} cols
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {table.columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {table.columns.map((col) => (
                  <td key={col}>{formatCell(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StructurePanel({ api }: SidePanelProps) {
  const { state, selectCell } = api
  const rootRef = useRef<HTMLDivElement>(null)

  // Flow prefers page scroll: grow the cell frame to fit the graph so the
  // side panel does not need a nested scrollbar/slider.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const lane = root.closest('.workspace-lane')
    if (!(lane instanceof HTMLElement)) return

    const apply = () => {
      const panel = root.closest('.side-panel')
      const header = panel?.querySelector('.panel-header')
      const body = root.closest('.side-panel-body')
      const headerH = header instanceof HTMLElement ? header.offsetHeight : 0
      const bodyStyle = body instanceof HTMLElement ? getComputedStyle(body) : null
      const padY = bodyStyle
        ? (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0)
        : 0
      const needed = Math.ceil(headerH + padY + root.scrollHeight)
      lane.style.setProperty('--flow-frame-min', `${needed}px`)
    }

    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(root)
    return () => {
      ro.disconnect()
      lane.style.removeProperty('--flow-frame-min')
    }
  }, [state.cells, state.language, state.activeCellId, state.scriptPath])

  return (
    <div className="structure-panel" ref={rootRef}>
      <div className="structure-file">
        <span className="mono">{state.scriptPath}</span>
      </div>
      <FlowGraphView
        cells={state.cells}
        language={state.language}
        activeCellId={state.activeCellId}
        onSelect={(cellId) => selectCell(cellId, 'structure')}
      />
    </div>
  )
}

function AiPanel({ api }: SidePanelProps) {
  const { state, activeCell } = api
  const [draft, setDraft] = useState('')
  const [thread, setThread] = useState<{ role: 'user' | 'agent'; text: string }[]>([
    {
      role: 'agent',
      text: 'I can see your active cell, environment, and recent runs. Ask for help — I suggest, you approve.',
    },
  ])

  const send = () => {
    const question = draft.trim()
    if (!question) return
    const envNames = state.env.map((item) => item.name).join(', ') || 'empty'
    const reply = [
      `Looking at **${activeCell.name}** (${activeCell.code.split('\n').length} lines).`,
      `Environment bindings: ${envNames}.`,
      state.history.length
        ? `Latest run status: ${state.history[state.history.length - 1]?.status}.`
        : 'No executions yet.',
      '',
      'Suggestion (preview only — not applied): keep this cell focused on one transformation.',
      '',
      'Authorize changes explicitly when you want edits applied.',
    ].join('\n')

    setThread((prev) => [...prev, { role: 'user', text: question }, { role: 'agent', text: reply }])
    setDraft('')
  }

  return (
    <div className="ai-panel">
      <div className="ai-thread">
        {thread.map((message, index) => (
          <div key={index} className={`ai-bubble ai-${message.role}`}>
            {message.text}
          </div>
        ))}
      </div>
      <div className="ai-compose">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What can I help you with?"
          onKeyDown={(event) => {
            if (event.key === 'Enter') send()
          }}
        />
        <button type="button" className="primary" onClick={send} aria-label="Send">
          ↑
        </button>
      </div>
    </div>
  )
}

function ConsolePanel({ api }: SidePanelProps) {
  const lines = api.activeCell.consoleLines ?? []
  if (lines.length === 0) {
    return <EmptyState text="No console output for this cell. Run it to capture kernel output." />
  }
  return (
    <div className="console-panel">
      <pre className="console-full">{lines.join('\n')}</pre>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

function formatCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}
