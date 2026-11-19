import { useEffect, useRef } from 'react'
import type { Cell } from '../types'

interface CellEditorProps {
  cell: Cell
  index: number
  onChange: (code: string) => void
  onRename: (name: string) => void
  onRun: () => void
}

export function CellEditor({ cell, index, onChange, onRename, onRun }: CellEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(220, el.scrollHeight)}px`
  }, [cell.code, cell.id])

  return (
    <section className="cell-editor" aria-label={`Editing ${cell.name}`}>
      <div className="cell-header">
        <span className="cell-index">#{index + 1}</span>
        <input
          className="cell-name-input"
          value={cell.name}
          onChange={(event) => onRename(event.target.value)}
          aria-label="Cell name"
        />
        <StatusPill status={cell.status} />
      </div>

      <textarea
        ref={ref}
        className="code-area"
        cols={80}
        spellCheck={false}
        wrap="off"
        value={cell.code}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            onRun()
            return
          }
          // Keep Shift+Tab for focus navigation out of the editor.
          if (event.key === 'Tab' && !event.shiftKey) {
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
        <code>// %%</code> cells · 80-column writing surface · ⌘/Ctrl+Enter to run · ribbon for the rest
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
