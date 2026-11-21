import { useEffect, useRef, useState, type ReactNode } from 'react'
import { highlightHtml } from '../lib/highlight'
import {
  completeOnRKernel,
  localCompletions,
  tokenBeforeCursor,
  type CompletionItem,
} from '../lib/rCompletions'
import type { Cell, EnvBinding, KernelLanguage } from '../types'

interface CellEditorProps {
  cell: Cell
  index: number
  total: number
  language: KernelLanguage
  /** Cached Env bindings — used for soft-fail completions when R is down. */
  env?: EnvBinding[]
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

interface PopupState {
  cellId: string
  items: CompletionItem[]
  prefix: string
  index: number
  /** Approximate caret anchor inside the textarea (CSS px). */
  top: number
  left: number
}

const COMPLETE_DEBOUNCE_MS = 120

export function CellEditor({
  cell,
  index,
  total,
  language,
  env = [],
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
  const frameRef = useRef<HTMLElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestGen = useRef(0)
  const [popup, setPopup] = useState<PopupState | null>(null)

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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Scoped to the active R cell so JS mode / cell jumps hide the popup without setState-in-effect.
  const visiblePopup =
    language === 'r' && popup && popup.cellId === cell.id && popup.items.length > 0
      ? popup
      : null

  const dismissPopup = () => setPopup(null)

  const applyCompletion = (item: CompletionItem, prefix: string) => {
    const el = ref.current
    if (!el) return
    // Prefer the live textarea value — React `cell.code` can lag one keystroke.
    const code = el.value
    const start = el.selectionStart
    const end = el.selectionEnd
    const token = tokenBeforeCursor(code, start)
    const before = code.slice(0, start)

    // rcompgen often returns the full `obj$member` / `pkg::name` label.
    // Manual / local items may be the bare member — insert after `$` / `::`.
    if (token.trigger === 'dollar' && /\$[A-Za-z.][A-Za-z0-9._]*$|\$$/.test(before)) {
      const dollarAt = before.lastIndexOf('$')
      const objName = before.slice(0, dollarAt).match(/([A-Za-z.][A-Za-z0-9._]*)$/)?.[1] ?? ''
      const member = item.label.includes('$')
        ? item.label.slice(item.label.lastIndexOf('$') + 1)
        : item.label
      if (!member || item.label === objName) {
        // Stale object-name suggestion after `$` — ignore.
        setPopup(null)
        return
      }
      const next = `${before.slice(0, dollarAt + 1)}${member}${code.slice(end)}`
      onChange(next)
      const caret = dollarAt + 1 + member.length
      setPopup(null)
      requestAnimationFrame(() => {
        el.focus()
        el.selectionStart = el.selectionEnd = caret
      })
      return
    }

    if (token.trigger === 'ns') {
      const nsAt = Math.max(before.lastIndexOf(':::'), before.lastIndexOf('::'))
      if (nsAt >= 0) {
        const opLen = before.slice(nsAt).startsWith(':::') ? 3 : 2
        const opEnd = nsAt + opLen
        const name = item.label.includes('::')
          ? item.label.slice(item.label.lastIndexOf(':') + 1)
          : item.label
        const next = `${before.slice(0, opEnd)}${name}${code.slice(end)}`
        onChange(next)
        const caret = opEnd + name.length
        setPopup(null)
        requestAnimationFrame(() => {
          el.focus()
          el.selectionStart = el.selectionEnd = caret
        })
        return
      }
    }

    // Identifiers: always replace the live token under the caret.
    const usePrefix = token.trigger === 'ident' ? token.prefix : (
      prefix && code.slice(Math.max(0, start - prefix.length), start) === prefix
        ? prefix
        : token.prefix
    )
    const replaceFrom = Math.max(0, start - usePrefix.length)
    const next = `${code.slice(0, replaceFrom)}${item.label}${code.slice(end)}`
    onChange(next)
    const caret = replaceFrom + item.label.length
    setPopup(null)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = caret
    })
  }

  const measureCaret = (el: HTMLTextAreaElement, cursor: number) => {
    const style = window.getComputedStyle(el)
    const lineHeight = Number.parseFloat(style.lineHeight) || 22
    const paddingTop = Number.parseFloat(style.paddingTop) || 0
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    // content-box width is 80ch; one ch ≈ that width / 80.
    const ch = el.clientWidth / 80
    const before = el.value.slice(0, cursor)
    const lineStart = before.lastIndexOf('\n') + 1
    const row = before.slice(0, lineStart).split('\n').length - 1
    const col = cursor - lineStart
    return {
      top: paddingTop + (row + 1) * lineHeight + 4 - el.scrollTop,
      left: paddingLeft + col * ch - el.scrollLeft,
    }
  }

  const insertTabSpaces = () => {
    const el = ref.current
    if (!el) return
    const code = el.value
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = `${code.slice(0, start)}  ${code.slice(end)}`
    onChange(next)
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 2
    })
  }

  const openCompletions = async (opts?: { explicit?: boolean }): Promise<boolean> => {
    if (language !== 'r') return false
    const el = ref.current
    if (!el) return false
    const cursor = el.selectionStart
    const token = tokenBeforeCursor(cell.code, cursor)
    if (!opts?.explicit && token.trigger === 'none') {
      setPopup(null)
      return false
    }

    const gen = ++requestGen.current
    const anchor = measureCaret(el, cursor)

    // Drop stale ident popups when entering `$` / `::` (local has nothing cheap).
    if (token.trigger === 'dollar' || token.trigger === 'ns') {
      setPopup(null)
    }

    // Instant local hint while the kernel answers (or when soft-failing).
    const local = localCompletions(el.value, cursor, env)
    if (local.items.length > 0) {
      setPopup({
        cellId: cell.id,
        items: local.items.slice(0, 12),
        prefix: local.prefix,
        index: 0,
        top: anchor.top,
        left: anchor.left,
      })
    } else if (
      !opts?.explicit &&
      (token.trigger === 'none' ||
        token.trigger === 'dollar' ||
        token.trigger === 'ns' ||
        (token.trigger === 'ident' && token.prefix.length < 1))
    ) {
      setPopup(null)
    }

    const remote = await completeOnRKernel(el.value, cursor, env)
    if (gen !== requestGen.current) return local.items.length > 0
    if (remote.items.length === 0) {
      if (!local.items.length) setPopup(null)
      return local.items.length > 0
    }
    const nextAnchor = measureCaret(el, el.selectionStart)
    setPopup({
      cellId: cell.id,
      items: remote.items.slice(0, 12),
      prefix: remote.prefix || token.prefix,
      index: 0,
      top: nextAnchor.top,
      left: nextAnchor.left,
    })
    return true
  }

  const scheduleCompletions = () => {
    if (language !== 'r') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void openCompletions()
    }, COMPLETE_DEBOUNCE_MS)
  }

  // Dual-layer highlight: colored <pre> under a transparent textarea (same metrics).
  const highlighted = highlightHtml(cell.code, language)

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
        <main className="main-window" ref={frameRef}>
          <div className="code-surface">
            <pre
              className="code-highlight"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
            <textarea
              ref={ref}
              className="code-area"
              cols={80}
              spellCheck={false}
              wrap="off"
              value={cell.code}
              aria-autocomplete={language === 'r' ? 'list' : undefined}
              aria-controls={visiblePopup ? 'r-completion-list' : undefined}
              aria-expanded={language === 'r' ? Boolean(visiblePopup) : undefined}
              onChange={(event) => {
                onChange(event.target.value)
                if (language !== 'r') {
                  dismissPopup()
                  return
                }
                const ch = event.target.value[event.target.selectionStart - 1]
                // `$` / `:` need an immediate kernel round-trip — no local list.
                if (ch === '$' || ch === ':') {
                  if (debounceRef.current) clearTimeout(debounceRef.current)
                  void openCompletions()
                } else {
                  scheduleCompletions()
                }
              }}
              onBlur={() => {
                // Delay so a mousedown on a completion item can fire first.
                window.setTimeout(() => {
                  if (document.activeElement !== ref.current) dismissPopup()
                }, 120)
              }}
              onClick={() => dismissPopup()}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  event.stopPropagation()
                  dismissPopup()
                  onRun()
                  return
                }
                // Alt+↑/↓ jump cells without fighting textarea caret motion.
                if (event.altKey && !event.metaKey && !event.ctrlKey) {
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    event.stopPropagation()
                    dismissPopup()
                    onPrevCell()
                    return
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    event.stopPropagation()
                    dismissPopup()
                    onNextCell()
                    return
                  }
                }

                if (language === 'r' && visiblePopup) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setPopup({
                      ...visiblePopup,
                      index: (visiblePopup.index + 1) % visiblePopup.items.length,
                    })
                    return
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setPopup({
                      ...visiblePopup,
                      index:
                        (visiblePopup.index - 1 + visiblePopup.items.length) %
                        visiblePopup.items.length,
                    })
                    return
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault()
                    applyCompletion(
                      visiblePopup.items[visiblePopup.index],
                      visiblePopup.prefix,
                    )
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    dismissPopup()
                    return
                  }
                }

                // Keep Shift+Tab for focus navigation out of the editor.
                if (event.key === 'Tab' && !event.shiftKey) {
                  event.preventDefault()
                  if (language === 'r') {
                    void openCompletions({ explicit: true }).then((opened) => {
                      if (!opened) insertTabSpaces()
                    })
                    return
                  }
                  insertTabSpaces()
                }
              }}
              placeholder={
                language === 'r'
                  ? '# Write the focused R cell here…'
                  : '// Write the focused cell here…'
              }
            />
          </div>
          {visiblePopup ? (
            <ul
              id="r-completion-list"
              className="r-completion-popup"
              role="listbox"
              aria-label="R completions"
              style={{ top: visiblePopup.top, left: Math.min(visiblePopup.left, 520) }}
            >
              {visiblePopup.items.map((item, itemIndex) => (
                <li key={`${item.label}-${itemIndex}`} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={itemIndex === visiblePopup.index}
                    className={
                      itemIndex === visiblePopup.index
                        ? 'r-completion-item is-active'
                        : 'r-completion-item'
                    }
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyCompletion(item, visiblePopup.prefix)
                    }}
                  >
                    <span className="r-completion-label">{item.label}</span>
                    <span className="r-completion-kind">{item.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
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
          {language === 'r' ? (
            <>
              <span className="cell-nav-dot">·</span>
              <kbd>Tab</kbd>
            </>
          ) : null}
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
