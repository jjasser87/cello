import { useEffect, useRef } from 'react'
import type { Cell } from '../types'

interface CellEditorProps {
  cell: Cell
  index: number
  total: number
  onChange: (code: string) => void
  onRename: (name: string) => void
  onRun: () => void
  onAdd: () => void
  onDelete: () => void
  onMove: (direction: -1 | 1) => void
}

export function CellEditor({
  cell,
  index,
  total,
  onChange,
  onRename,
  onRun,
  onAdd,
  onDelete,
  onMove,
}: CellEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(220, el.scrollHeight)}px`
  }, [cell.code, cell.id])

  return (
    <section className="cell-editor" aria-label={`Editing ${cell.name}`}>
      <div className="cell-toolbar">
        <div className="cell-identity">
          <span className="cell-index">#{index + 1}</span>
          <input
            className="cell-name-input"
            value={cell.name}
            onChange={(event) => onRename(event.target.value)}
            aria-label="Cell name"
          />
          <StatusPill status={cell.status} />
        </div>
        <div className="cell-actions">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} title="Move up">
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Move down"
          >
            ↓
          </button>
          <button type="button" onClick={onAdd} title="Add cell below">
            + Cell
          </button>
          <button type="button" onClick={onDelete} disabled={total <= 1} title="Delete cell">
            Delete
          </button>
          <button type="button" className="primary" onClick={onRun} title="Run cell (⌘/Ctrl+Enter)">
            Run
          </button>
        </div>
      </div>

      <textarea
        ref={ref}
        className="code-area"
        spellCheck={false}
        value={cell.code}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            onRun()
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            const target = event.currentTarget
            const start = target.selectionStart
            const end = target.selectionEnd
            const next = `${cell.code.slice(0, start)}  ${cell.code.slice(end)}`
            onChange(next)
            requestAnimationFrame(() => {
              target.selectionStart = target.selectionEnd = start + 2
            })
          }
        }}
        placeholder="// Write the focused cell here…"
      />

      {cell.error ? <div className="cell-error">Error: {cell.error}</div> : null}
      <p className="editor-footnote">
        <code># %%</code> cells · ⌘/Ctrl+Enter to run · open the ribbon for Flow, History, Plot, and more
      </p>
    </section>
  )
}

function StatusPill({ status }: { status: Cell['status'] }) {
  const label =
    status === 'running'
      ? 'Running'
      : status === 'ok'
        ? 'Ok'
        : status === 'error'
          ? 'Error'
          : 'Idle'
  return <span className={`status-pill status-${status}`}>{label}</span>
}
