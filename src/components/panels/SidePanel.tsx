import { useRef, useState } from 'react'
import { FlowGraphView } from '../FlowGraph'
import { diffLines } from '../../lib/diff'
import { useOverflowFade } from '../../hooks/useOverflowFade'
import type { WorkspaceApi } from '../../hooks/useWorkspace'
import type { PanelId } from '../../types'
import { ExplainPanel } from './ExplainPanel'
import { FilesPanel } from './FilesPanel'

const RIBBON_ITEMS: { id: PanelId; label: string; short: string }[] = [
  { id: 'cells', label: 'Cells', short: 'Ce' },
  { id: 'explain', label: 'Explain', short: 'Ex' },
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
  const bodyRef = useRef<HTMLDivElement>(null)

  const isFlow = open && state.activePanel === 'structure'
  const moreBelow = useOverflowFade(bodyRef)

  return (
    <aside
      className={`side-shell ${open ? 'is-open' : 'is-collapsed'}${isFlow ? ' is-flow' : ''}`}
      data-panel={open ? state.activePanel : undefined}
      aria-label={open ? `${state.activePanel} panel` : 'Panel ribbon'}
    >
      {/*
        DOM order: panel slot, then ribbon. CSS flex-direction (per data-dock)
        keeps the ribbon on the outer edge and the panel adjacent to the cell.
      */}
      <div
        className="side-panel-slot"
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="side-panel">
          <PanelHeader panel={state.activePanel} onCollapse={collapseSidePanel} />
          <div
            className="side-panel-scroll"
            data-more-below={moreBelow ? 'true' : 'false'}
          >
            <div
              ref={bodyRef}
              className={`side-panel-body${isFlow ? ' is-flow' : ''}`}
            >
              {state.activePanel === 'cells' && <CellsPanel api={api} />}
              {state.activePanel === 'explain' && <ExplainPanel api={api} />}
              {state.activePanel === 'history' && <HistoryPanel api={api} />}
              {state.activePanel === 'plot' && <PlotPanel api={api} />}
              {state.activePanel === 'files' && <FilesPanel api={api} />}
              {state.activePanel === 'env' && <EnvPanel api={api} />}
              {state.activePanel === 'data' && <DataPanel api={api} />}
              {state.activePanel === 'structure' && <StructurePanel api={api} />}
              {state.activePanel === 'console' && <ConsolePanel api={api} />}
              {state.activePanel === 'ai' && <AiPanel api={api} />}
            </div>
            <div className="side-panel-fade" aria-hidden="true" />
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
    explain: { title: 'Explain', blurb: 'Purpose doc for this cell.' },
    history: { title: 'History', blurb: 'Prior cell source for this cell.' },
    plot: { title: 'Plot', blurb: 'Prior plots for the selected cell.' },
    files: { title: 'Files', blurb: 'Project tree.' },
    env: { title: 'Environment', blurb: 'Bindings in the kernel.' },
    data: { title: 'Data', blurb: 'Prior tables for the selected cell.' },
    structure: { title: 'Script flow', blurb: 'Auto graph of how cells connect.' },
    console: { title: 'Console', blurb: 'Prior runs for the selected cell.' },
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
  const { state, setHistoryIndex, revertCodeHistory } = api
  const cellHistory = state.history.filter((entry) => entry.cellId === state.activeCellId)
  if (cellHistory.length === 0) {
    return <EmptyState text="No code history for this cell yet. Run it to keep prior source." />
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
  const canRevert = localIndex < cellHistory.length - 1
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
          aria-label="Previous code version"
        >
          ←
        </button>
        <div>
          <strong>{entry.cellName}</strong>
          <div className="muted">
            Code {localIndex + 1} / {cellHistory.length} ·{' '}
            {new Date(entry.timestamp).toLocaleTimeString()}
            {entry.status === 'error' ? ' · error' : ''}
          </div>
          <p className="muted small history-restore-hint">
            Browse restores the source. Revert also deletes newer versions.
          </p>
          <button
            type="button"
            className="history-revert-btn"
            disabled={!canRevert}
            title={
              canRevert
                ? 'Restore this version and delete every newer code history entry for this cell'
                : 'Already at the latest version'
            }
            onClick={() => revertCodeHistory(entry.id)}
          >
            Revert
          </button>
        </div>
        <button
          type="button"
          onClick={() => goToLocal(localIndex + 1)}
          disabled={localIndex >= cellHistory.length - 1}
          aria-label="Next code version"
        >
          →
        </button>
      </div>

      {cellHistory.length > 1 ? (
        <ul className="panel-run-list" aria-label="Code versions for this cell">
          {cellHistory
            .slice()
            .reverse()
            .map((item, reverseIndex) => {
              // Display is newest-first; itemLocal stays chronological (0 = oldest).
              const itemLocal = cellHistory.length - 1 - reverseIndex
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === entry.id ? 'is-active' : ''}
                    onClick={() => {
                      const globalIndex = state.history.findIndex((h) => h.id === item.id)
                      if (globalIndex >= 0) setHistoryIndex(globalIndex)
                    }}
                  >
                    <span className="panel-run-meta">
                      <span className="mono">#{itemLocal + 1}</span>
                      <span className="muted">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      {item.status === 'error' ? (
                        <span className="history-run-error">err</span>
                      ) : null}
                    </span>
                    <span className="muted small panel-run-preview">
                      {item.code.trim().split('\n')[0]?.slice(0, 42) || '(empty)'}
                    </span>
                  </button>
                </li>
              )
            })}
        </ul>
      ) : null}

      {entry.error ? <div className="cell-error">Error: {entry.error}</div> : null}

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
          <div className="diff-label">This version</div>
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
    </div>
  )
}

function PlotPanel({ api }: SidePanelProps) {
  const { state, setActivePlotId, revertPlotHistory } = api
  const cellPlots = state.plots.filter((item) => item.cellId === state.activeCellId)
  const plot =
    cellPlots.find((item) => item.id === state.activePlotId) ??
    cellPlots[cellPlots.length - 1]

  if (!plot) {
    return (
      <EmptyState text="No plot for this cell. Use plot() / ggplot(), or cello.plot({ labels, values }) — this panel opens automatically." />
    )
  }

  const localIndex = cellPlots.findIndex((item) => item.id === plot.id)
  const canRevert = localIndex < cellPlots.length - 1

  return (
    <div className="plot-panel">
      <div className="history-nav">
        <button
          type="button"
          onClick={() => {
            const prev = cellPlots[localIndex - 1]
            if (prev) setActivePlotId(prev.id)
          }}
          disabled={localIndex <= 0}
          aria-label="Previous plot"
        >
          ←
        </button>
        <div>
          <strong>{plot.title}</strong>
          <div className="muted">
            Plot {localIndex + 1} / {cellPlots.length} ·{' '}
            {new Date(plot.createdAt).toLocaleTimeString()}
          </div>
          <p className="muted small history-restore-hint">
            Browse restores the code. Revert also deletes newer plots.
          </p>
          <button
            type="button"
            className="history-revert-btn"
            disabled={!canRevert}
            title={
              canRevert
                ? 'Restore this plot’s code and delete every newer plot for this cell'
                : 'Already at the latest plot'
            }
            onClick={() => revertPlotHistory(plot.id)}
          >
            Revert
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = cellPlots[localIndex + 1]
            if (next) setActivePlotId(next.id)
          }}
          disabled={localIndex >= cellPlots.length - 1}
          aria-label="Next plot"
        >
          →
        </button>
      </div>

      {plot.kind === 'image' && plot.imageData ? (
        <img className="plot-image" src={plot.imageData} alt={plot.title} />
      ) : plot.kind === 'line' ? (
        <LineChart plot={plot} />
      ) : (
        <BarChart plot={plot} />
      )}

      {cellPlots.length > 1 ? (
        <ul className="panel-run-list" aria-label="Plots for this cell">
          {cellPlots
            .slice()
            .reverse()
            .map((item, reverseIndex) => {
              const itemLocal = cellPlots.length - 1 - reverseIndex
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === plot.id ? 'is-active' : ''}
                    onClick={() => setActivePlotId(item.id)}
                  >
                    <span className="panel-run-meta">
                      <span className="mono">#{itemLocal + 1}</span>
                      <span>{item.title}</span>
                    </span>
                    <span className="muted small">{item.kind}</span>
                  </button>
                </li>
              )
            })}
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
  const { state, setActiveTableId, revertTableHistory } = api
  const cellTables = state.tables.filter((item) => item.cellId === state.activeCellId)
  const table =
    cellTables.find((item) => item.id === state.activeTableId) ??
    cellTables[cellTables.length - 1]

  if (!table) {
    return (
      <EmptyState text="No table for this cell. Create a data.frame / tibble / matrix, or use cello.table() — this panel opens automatically." />
    )
  }

  const localIndex = cellTables.findIndex((item) => item.id === table.id)
  const canRevert = localIndex < cellTables.length - 1

  return (
    <div className="data-panel">
      <div className="history-nav">
        <button
          type="button"
          onClick={() => {
            const prev = cellTables[localIndex - 1]
            if (prev) setActiveTableId(prev.id)
          }}
          disabled={localIndex <= 0}
          aria-label="Previous table"
        >
          ←
        </button>
        <div>
          <strong>{table.name}</strong>
          <div className="muted">
            Table {localIndex + 1} / {cellTables.length} · {table.rows.length} rows ·{' '}
            {table.columns.length} cols · {new Date(table.createdAt).toLocaleTimeString()}
          </div>
          <p className="muted small history-restore-hint">
            Browse restores the code. Revert also deletes newer tables.
          </p>
          <button
            type="button"
            className="history-revert-btn"
            disabled={!canRevert}
            title={
              canRevert
                ? 'Restore this table’s code and delete every newer table for this cell'
                : 'Already at the latest table'
            }
            onClick={() => revertTableHistory(table.id)}
          >
            Revert
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = cellTables[localIndex + 1]
            if (next) setActiveTableId(next.id)
          }}
          disabled={localIndex >= cellTables.length - 1}
          aria-label="Next table"
        >
          →
        </button>
      </div>

      {cellTables.length > 1 ? (
        <ul className="panel-run-list" aria-label="Tables for this cell">
          {cellTables
            .slice()
            .reverse()
            .map((item, reverseIndex) => {
              const itemLocal = cellTables.length - 1 - reverseIndex
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === table.id ? 'is-active' : ''}
                    onClick={() => setActiveTableId(item.id)}
                  >
                    <span className="panel-run-meta">
                      <span className="mono">#{itemLocal + 1}</span>
                      <span>{item.name}</span>
                    </span>
                    <span className="muted small">
                      {item.rows.length}×{item.columns.length}
                    </span>
                  </button>
                </li>
              )
            })}
        </ul>
      ) : null}

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

  // Flow stays inside the fixed helper panel and scrolls there (with fade cue),
  // rather than growing the editor frame when the graph is tall.
  return (
    <div className="structure-panel">
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
  const { state, setActiveConsoleId, revertConsoleHistory } = api
  const cellRuns = state.consoleEntries.filter((entry) => entry.cellId === state.activeCellId)
  const entry =
    cellRuns.find((item) => item.id === state.activeConsoleId) ??
    cellRuns[cellRuns.length - 1]

  if (!entry) {
    return <EmptyState text="No console output for this cell. Run it to capture kernel output." />
  }

  const localIndex = cellRuns.findIndex((item) => item.id === entry.id)
  const canRevert = localIndex < cellRuns.length - 1

  return (
    <div className="console-panel">
      <div className="history-nav">
        <button
          type="button"
          onClick={() => {
            const prev = cellRuns[localIndex - 1]
            if (prev) setActiveConsoleId(prev.id)
          }}
          disabled={localIndex <= 0}
          aria-label="Previous console run"
        >
          ←
        </button>
        <div>
          <strong>Console run</strong>
          <div className="muted">
            Run {localIndex + 1} / {cellRuns.length} ·{' '}
            {new Date(entry.timestamp).toLocaleTimeString()}
            {entry.status === 'error' ? ' · error' : ''}
          </div>
          <p className="muted small history-restore-hint">
            Browse restores the code. Revert also deletes newer runs.
          </p>
          <button
            type="button"
            className="history-revert-btn"
            disabled={!canRevert}
            title={
              canRevert
                ? 'Restore this run’s code and delete every newer console run for this cell'
                : 'Already at the latest run'
            }
            onClick={() => revertConsoleHistory(entry.id)}
          >
            Revert
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = cellRuns[localIndex + 1]
            if (next) setActiveConsoleId(next.id)
          }}
          disabled={localIndex >= cellRuns.length - 1}
          aria-label="Next console run"
        >
          →
        </button>
      </div>

      {cellRuns.length > 1 ? (
        <ul className="panel-run-list" aria-label="Console runs for this cell">
          {cellRuns
            .slice()
            .reverse()
            .map((item, reverseIndex) => {
              const itemLocal = cellRuns.length - 1 - reverseIndex
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.id === entry.id ? 'is-active' : ''}
                    onClick={() => setActiveConsoleId(item.id)}
                  >
                    <span className="panel-run-meta">
                      <span className="mono">#{itemLocal + 1}</span>
                      <span className="muted">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                      {item.status === 'error' ? (
                        <span className="history-run-error">err</span>
                      ) : null}
                    </span>
                    <span className="muted small panel-run-preview">
                      {item.text.trim().split('\n')[0]?.slice(0, 42) || '(no output)'}
                    </span>
                  </button>
                </li>
              )
            })}
        </ul>
      ) : null}

      <pre className="console-full">{entry.text}</pre>
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
