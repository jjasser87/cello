import { useState } from 'react'
import { diffLines } from '../../lib/diff'
import type { WorkspaceApi } from '../../hooks/useWorkspace'
import type { PanelId, ProjectFile } from '../../types'

interface SidePanelProps {
  api: WorkspaceApi
}

export function SidePanel({ api }: SidePanelProps) {
  const { state } = api
  return (
    <aside className="side-panel" aria-label={`${state.activePanel} panel`}>
      <PanelHeader panel={state.activePanel} />
      <div className="side-panel-body">
        {state.activePanel === 'cells' && <CellsPanel api={api} />}
        {state.activePanel === 'history' && <HistoryPanel api={api} />}
        {state.activePanel === 'plot' && <PlotPanel api={api} />}
        {state.activePanel === 'files' && <FilesPanel api={api} />}
        {state.activePanel === 'env' && <EnvPanel api={api} />}
        {state.activePanel === 'data' && <DataPanel api={api} />}
        {state.activePanel === 'structure' && <StructurePanel api={api} />}
        {state.activePanel === 'ai' && <AiPanel api={api} />}
      </div>
      <ConsoleDock lines={state.consoleLines} />
    </aside>
  )
}

function PanelHeader({ panel }: { panel: PanelId }) {
  const titles: Record<PanelId, { title: string; blurb: string }> = {
    cells: { title: 'Cells', blurb: 'Order determines script flow. Drag mentally — use ↑↓ to reorder.' },
    history: { title: 'History', blurb: 'Step through executions. Red left, green right.' },
    plot: { title: 'Plot', blurb: 'Auto-opens when a cell calls cello.plot().' },
    files: { title: 'Files', blurb: 'Project tree stub for the focused workspace.' },
    env: { title: 'Environment', blurb: 'Bindings left behind by executed cells.' },
    data: { title: 'Data', blurb: 'Tables from cello.table() — dataframe / CSV style preview.' },
    structure: { title: 'Script flow', blurb: 'See where this cell sits without leaving focus mode.' },
    ai: { title: 'Agent', blurb: 'Context-aware help. Suggests — never silently rewrites.' },
  }
  const copy = titles[panel]
  return (
    <div className="panel-header">
      <h2>{copy.title}</h2>
      <p>{copy.blurb}</p>
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
            <button type="button" onClick={() => deleteCell(cell.id)} disabled={state.cells.length <= 1}>
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
  if (state.history.length === 0) {
    return <EmptyState text="Run a cell to start building execution history." />
  }
  const index = state.historyIndex < 0 ? state.history.length - 1 : state.historyIndex
  const entry = state.history[index]
  const lines = diffLines(entry.previousCode, entry.code)

  return (
    <div className="history-panel">
      <div className="history-nav">
        <button
          type="button"
          onClick={() => setHistoryIndex(index - 1)}
          disabled={index <= 0}
          aria-label="Previous version"
        >
          ←
        </button>
        <div>
          <strong>{entry.cellName}</strong>
          <div className="muted">
            {index + 1} / {state.history.length} · {new Date(entry.timestamp).toLocaleTimeString()}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setHistoryIndex(index + 1)}
          disabled={index >= state.history.length - 1}
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

      {entry.outputText ? (
        <pre className="output-block">{entry.outputText}</pre>
      ) : null}
      {entry.error ? <div className="cell-error">Error: {entry.error}</div> : null}

      <button type="button" className="primary wide" onClick={restoreHistoryCode}>
        Restore this code into the cell
      </button>
    </div>
  )
}

function PlotPanel({ api }: SidePanelProps) {
  const { state } = api
  const plot =
    state.plots.find((item) => item.id === state.activePlotId) ??
    state.plots[state.plots.length - 1]

  if (!plot) {
    return (
      <EmptyState text="No plots yet. Call cello.plot({ labels, values }) from a cell — this panel opens automatically." />
    )
  }

  const max = Math.max(...plot.values, 1)

  return (
    <div className="plot-panel">
      <div className="plot-title-row">
        <h3>{plot.title}</h3>
        <span className="muted">{plot.kind}</span>
      </div>
      <div className="bar-chart" role="img" aria-label={plot.title}>
        {plot.labels.map((label, index) => (
          <div key={`${label}-${index}`} className="bar-col">
            <div
              className="bar"
              style={{ height: `${(plot.values[index] / max) * 100}%` }}
              title={`${label}: ${plot.values[index]}`}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <ul className="plot-list">
        {state.plots
          .slice()
          .reverse()
          .map((item) => (
            <li key={item.id} className={item.id === plot.id ? 'is-active' : ''}>
              {item.title}
            </li>
          ))}
      </ul>
    </div>
  )
}

function FilesPanel({ api }: SidePanelProps) {
  return (
    <div className="file-tree">
      <p className="muted small">
        Active script: <code>{api.state.scriptPath}</code> (stored as plain text with{' '}
        <code># %%</code> cells)
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
    return <EmptyState text="Environment is empty. Run cells to populate variables, tables, and helpers." />
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
  const table =
    state.tables.find((item) => item.id === state.activeTableId) ??
    state.tables[state.tables.length - 1]

  if (!table) {
    return (
      <EmptyState text="No tables yet. Use cello.table(rows, 'name') to preview dataframes / CSV-like data." />
    )
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
  return (
    <div className="structure-panel">
      <div className="structure-file">
        <span className="mono">{state.scriptPath}</span>
      </div>
      <ol className="flow-list">
        {state.cells.map((cell, index) => (
          <li key={cell.id}>
            <button
              type="button"
              className={cell.id === state.activeCellId ? 'is-current' : ''}
              onClick={() => selectCell(cell.id, 'structure')}
            >
              <span>
                {index + 1}. {cell.name}
              </span>
              <span className={`status-pill status-${cell.status}`}>{cell.status}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="muted small">
        Dependency graphs come later. v0 shows execution order — the relationship that always
        matters for a linear script.
      </p>
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
      'Suggestion (preview only — not applied): keep this cell focused on one transformation, and move plotting into the next cell so Flow stays readable.',
      '',
      'Authorize changes explicitly when you want edits applied. This stub does not rewrite your script.',
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
          placeholder="Agent: what can I help you with?"
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

function ConsoleDock({ lines }: { lines: string[] }) {
  return (
    <div className="console-dock">
      <div className="console-label">Console</div>
      <pre>{lines.slice(-12).join('\n')}</pre>
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

