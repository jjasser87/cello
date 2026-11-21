import { useEffect, useRef, type ReactNode } from 'react'
import type { Cell, KernelLanguage } from '../types'

interface CellEditorProps {
  cell: Cell
  index: number
  total: number
  language: KernelLanguage
  /** Short kernel label shown in the nav row (keep brief). */
  kernelHint?: string
  /** Optional longer detail for the kernel label tooltip. */
  kernelDetail?: string
  onChange: (code: string) => void
  onRename: (name: string) => void
  onRun: () => void
  onPrevCell: () => void
  onNextCell: () => void
  /** Compact action icons beside the title. */
  toolbar: ReactNode
  /** Ribbon/panel cluster; height-pinned to the code frame only. */
  sidePanel: ReactNode
}

export function CellEditor({
  cell,
  index,
  total,
  language,
  kernelHint,
  kernelDetail,
  onChange,
  onRename,
  onRun,
  onPrevCell,
  onNextCell,
  toolbar,
  sidePanel,
}: CellEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // Grow with content; CSS min-height keeps the ribbon track fully visible (no inner scroll).
    el.style.height = `${Math.max(el.scrollHeight, 220)}px`
  }, [cell.code, cell.id])

  useEffect(() => {
    // Keep the writing surface focused after jumping cells via nav / shortcuts.
    ref.current?.focus({ preventScroll: true })
  }, [cell.id])

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
        {toolbar}
      </div>

      {/*
        Lane owns only the writing-surface frame. Header and nav sit
        outside so the ribbon top/bottom match the code-area edges exactly.
      */}
      <div className="workspace-lane">
        <main className="main-window">
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
              // Alt+↑/↓ jump cells without fighting textarea caret motion.
              if (event.altKey && !event.metaKey && !event.ctrlKey) {
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  event.stopPropagation()
                  onPrevCell()
                  return
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  event.stopPropagation()
                  onNextCell()
                  return
                }
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
            placeholder={
              language === 'r'
                ? '# Write the focused R cell here…'
                : '// Write the focused cell here…'
            }
          />
        </main>
        {sidePanel}
      </div>

      {cell.error ? <div className="cell-error">Error: {cell.error}</div> : null}

      <nav className="cell-nav" aria-label="Cell navigation">
        <button
          type="button"
          className="cell-nav-btn"
          onClick={onPrevCell}
          disabled={index <= 0}
          title="Previous cell (Alt+↑)"
          aria-label="Previous cell"
        >
          ←
        </button>
        <span className="cell-nav-pos" aria-live="polite">
          {index + 1}
          <span className="cell-nav-sep">/</span>
          {total}
        </span>
        <button
          type="button"
          className="cell-nav-btn"
          onClick={onNextCell}
          disabled={index >= total - 1}
          title="Next cell (Alt+↓)"
          aria-label="Next cell"
        >
          →
        </button>
        <span className="cell-nav-hint" title="Keyboard shortcuts">
          <kbd>Alt</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          <span className="cell-nav-dot">·</span>
          <kbd>⌘↵</kbd>
        </span>
        <span
          className="cell-nav-kernel"
          title={kernelDetail ?? kernelHint ?? (language === 'r' ? 'R' : 'JS')}
        >
          {kernelHint ?? (language === 'r' ? 'R' : 'JS')}
        </span>
      </nav>
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
