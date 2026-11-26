import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useOverflowFade } from '../hooks/useOverflowFade'
import { highlightHtml } from '../lib/highlight'
import {
  completeOnRKernel,
  localCompletions,
  tokenBeforeCursor,
  type CompletionItem,
} from '../lib/rCompletions'
import {
  diagnosticAt,
  lintR,
  matchDelimiterAt,
  type RDiagnostic,
} from '../lib/rLint'
import type { Cell, EnvBinding, KernelLanguage } from '../types'

interface CellEditorProps {
  cell: Cell
  index: number
  total: number
  language: KernelLanguage
  /** Settings: client-side R structural lint (default off). */
  rLintEnabled?: boolean
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

interface LintHoverState {
  cellId: string
  message: string
  severity: 'error' | 'warning'
  top: number
  left: number
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
/** Idle pause before full (indent / unmatched-open) lint — RStudio-like comfort. */
const LINT_IDLE_MS = 550

export function CellEditor({
  cell,
  index,
  total,
  language,
  rLintEnabled = false,
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
  const highlightRef = useRef<HTMLPreElement>(null)
  const lintGutterRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lintIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestGen = useRef(0)
  const [popup, setPopup] = useState<PopupState | null>(null)
  /**
   * Soft while typing; full after idle/blur when lint is enabled.
   * cellId gates stale soft mode after cell jumps (no setState-in-effect).
   */
  const [lintGate, setLintGate] = useState<{ cellId: string; mode: 'soft' | 'full' }>({
    cellId: cell.id,
    mode: 'full',
  })
  const lintMode = lintGate.cellId === cell.id ? lintGate.mode : 'full'
  const [caretOffset, setCaretOffset] = useState(0)
  const [lintHover, setLintHover] = useState<LintHoverState | null>(null)
  const visibleLintHover =
    lintHover && lintHover.cellId === cell.id && rLintEnabled ? lintHover : null
  // Shade cues track textarea overflow; contentKey covers value-driven growth.
  const { moreBelow, moreRight } = useOverflowFade(ref, `${cell.id}:${cell.code}`)

  useEffect(() => {
    // Keep the writing surface focused after jumping cells via nav / shortcuts.
    ref.current?.focus({ preventScroll: true })
    // Reset dual-layer scroll so a tall previous cell does not leave the highlight offset.
    const el = ref.current
    const hi = highlightRef.current
    const gutter = lintGutterRef.current
    if (el) {
      el.scrollTop = 0
      el.scrollLeft = 0
    }
    if (hi) {
      hi.scrollTop = 0
      hi.scrollLeft = 0
    }
    if (gutter) gutter.scrollTop = 0
  }, [cell.id])

  /** Keep the highlight / lint gutter lined up when the textarea scrolls. */
  const syncHighlightScroll = () => {
    const el = ref.current
    const hi = highlightRef.current
    if (!el || !hi) return
    hi.scrollTop = el.scrollTop
    hi.scrollLeft = el.scrollLeft
    const gutter = lintGutterRef.current
    if (gutter) gutter.scrollTop = el.scrollTop
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (lintIdleRef.current) clearTimeout(lintIdleRef.current)
    }
  }, [])

  // Scoped to the active R cell so JS mode / cell jumps hide the popup without setState-in-effect.
  const visiblePopup =
    language === 'r' && popup && popup.cellId === cell.id && popup.items.length > 0
      ? popup
      : null

  const dismissPopup = () => setPopup(null)

  const scheduleFullLint = () => {
    if (lintIdleRef.current) clearTimeout(lintIdleRef.current)
    lintIdleRef.current = setTimeout(() => {
      setLintGate({ cellId: cell.id, mode: 'full' })
    }, LINT_IDLE_MS)
  }

  const noteTypingForLint = () => {
    if (!rLintEnabled || language !== 'r') return
    setLintGate({ cellId: cell.id, mode: 'soft' })
    scheduleFullLint()
  }

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

  // Client-side R lint (parens / brackets / indent) — never blocks Run.
  // Soft while typing; full after idle/blur. Off entirely when setting disabled.
  const diagnostics = useMemo(() => {
    if (language !== 'r' || !rLintEnabled) return [] as RDiagnostic[]
    return lintR(cell.code, { soft: lintMode === 'soft' })
  }, [language, rLintEnabled, cell.code, lintMode])

  // Matching paren highlight at the caret — always on for R (not gated by lint).
  const matchRanges = useMemo(() => {
    if (language !== 'r') return []
    const match = matchDelimiterAt(cell.code, caretOffset)
    if (!match) return []
    return [
      { from: match.from, to: match.to },
      { from: match.matchFrom, to: match.matchTo },
    ]
  }, [language, cell.code, caretOffset])

  // Dual-layer highlight: colored <pre> under a transparent textarea (same metrics).
  const highlighted = highlightHtml(cell.code, language, {
    diagnostics: language === 'r' && rLintEnabled ? diagnostics : undefined,
    matchRanges: language === 'r' ? matchRanges : undefined,
  })

  const lintMarkers = useMemo(
    () => buildLintMarkers(diagnostics, cell.code),
    [diagnostics, cell.code],
  )

  // When lint markers mount/update, align gutter scroll with the live textarea.
  useEffect(() => {
    const el = ref.current
    const gutter = lintGutterRef.current
    if (el && gutter) gutter.scrollTop = el.scrollTop
  }, [lintMarkers.length, cell.code])

  /** Map pointer position over the transparent textarea to a source offset. */
  const offsetFromPointer = (el: HTMLTextAreaElement, clientX: number, clientY: number) => {
    const style = window.getComputedStyle(el)
    const lineHeight = Number.parseFloat(style.lineHeight) || 22
    const paddingTop = Number.parseFloat(style.paddingTop) || 0
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    const rect = el.getBoundingClientRect()
    const ch = el.clientWidth / 80
    const x = clientX - rect.left + el.scrollLeft - paddingLeft
    const y = clientY - rect.top + el.scrollTop - paddingTop
    const row = Math.max(0, Math.floor(y / lineHeight))
    const col = Math.max(0, Math.floor(x / Math.max(ch, 1)))
    const lines = el.value.split('\n')
    let offset = 0
    for (let i = 0; i < lines.length; i += 1) {
      if (i === row) {
        return offset + Math.min(col, lines[i].length)
      }
      offset += lines[i].length + 1
    }
    return el.value.length
  }

  const updateLintHover = (el: HTMLTextAreaElement, clientX: number, clientY: number) => {
    if (!rLintEnabled || language !== 'r' || diagnostics.length === 0) {
      setLintHover(null)
      return
    }
    const offset = offsetFromPointer(el, clientX, clientY)
    const hit = diagnosticAt(diagnostics, offset)
    if (!hit) {
      setLintHover(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const frame = frameRef.current?.getBoundingClientRect()
    const top = clientY - (frame?.top ?? rect.top) + 18
    const left = Math.min(
      Math.max(8, clientX - (frame?.left ?? rect.left) + 12),
      (frame?.width ?? rect.width) - 16,
    )
    setLintHover({
      cellId: cell.id,
      message: hit.message,
      severity: hit.severity,
      top,
      left,
    })
  }

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
          <div
            className="code-surface"
            data-more-below={moreBelow ? 'true' : 'false'}
            data-more-right={moreRight ? 'true' : 'false'}
            data-has-lint={diagnostics.length > 0 ? 'true' : 'false'}
          >
            {/* Gutter dots in the left padding — do not change the 80ch writing width. */}
            {lintMarkers.length > 0 ? (
              <div ref={lintGutterRef} className="code-lint-gutter" aria-hidden="true">
                <div
                  className="code-lint-gutter-inner"
                  style={{ height: lintMarkersContentHeight(cell.code) }}
                >
                  {lintMarkers.map((marker) => (
                    <span
                      key={`${marker.line}-${marker.severity}`}
                      className={`code-lint-marker code-lint-marker-${marker.severity}`}
                      style={{ top: marker.topPx }}
                      title={marker.title}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            <pre
              ref={highlightRef}
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
              onScroll={syncHighlightScroll}
              onChange={(event) => {
                onChange(event.target.value)
                setCaretOffset(event.target.selectionStart)
                noteTypingForLint()
                setLintHover(null)
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
              onSelect={(event) => {
                setCaretOffset(event.currentTarget.selectionStart)
              }}
              onKeyUp={(event) => {
                setCaretOffset(event.currentTarget.selectionStart)
              }}
              onMouseMove={(event) => {
                updateLintHover(event.currentTarget, event.clientX, event.clientY)
              }}
              onMouseLeave={() => setLintHover(null)}
              onBlur={() => {
                // Full lint when leaving the cell — finished-code check.
                if (rLintEnabled && language === 'r') {
                  if (lintIdleRef.current) clearTimeout(lintIdleRef.current)
                  setLintGate({ cellId: cell.id, mode: 'full' })
                }
                setLintHover(null)
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
            {/* Edge shades cue overflow — no scrollbar chrome (match helper panels). */}
            <div className="code-surface-fade code-surface-fade-y" aria-hidden="true" />
            <div className="code-surface-fade code-surface-fade-x" aria-hidden="true" />
          </div>
          {visibleLintHover ? (
            <div
              className={`code-lint-tooltip code-lint-tooltip-${visibleLintHover.severity}`}
              role="tooltip"
              style={{
                top: visibleLintHover.top,
                left: Math.min(visibleLintHover.left, 520),
              }}
            >
              {visibleLintHover.message}
            </div>
          ) : null}
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

      {diagnostics.length > 0 ? (
        <div className="cell-lint" role="status" aria-live="polite">
          <span className="cell-lint-summary">
            {formatLintSummary(diagnostics)}
          </span>
          <ul className="cell-lint-list">
            {diagnostics.slice(0, 4).map((d) => (
              <li
                key={`${d.kind}-${d.from}-${d.message}`}
                className={`cell-lint-item cell-lint-${d.severity}`}
              >
                <span className="cell-lint-loc">
                  L{d.line}:{d.col}
                </span>
                <span className="cell-lint-msg">{d.message}</span>
              </li>
            ))}
            {diagnostics.length > 4 ? (
              <li className="cell-lint-item cell-lint-more">
                +{diagnostics.length - 4} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

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

function formatLintSummary(diagnostics: RDiagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors
  const parts: string[] = []
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`)
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

interface LintMarker {
  line: number
  severity: 'error' | 'warning'
  topPx: number
  title: string
}

const LINT_LINE_HEIGHT_PX = 22
const LINT_PAD_TOP_PX = 16

/** One gutter marker per line — error wins over warning. Syncs with editor metrics. */
function buildLintMarkers(diagnostics: RDiagnostic[], _code: string): LintMarker[] {
  if (diagnostics.length === 0) return []
  const byLine = new Map<number, RDiagnostic>()
  for (const d of diagnostics) {
    const prev = byLine.get(d.line)
    if (!prev || (prev.severity !== 'error' && d.severity === 'error')) {
      byLine.set(d.line, d)
    }
  }
  return [...byLine.entries()].map(([line, d]) => ({
    line,
    severity: d.severity,
    // Center the dot on the line box (scroll synced via gutter ref).
    topPx: LINT_PAD_TOP_PX + (line - 1) * LINT_LINE_HEIGHT_PX + LINT_LINE_HEIGHT_PX / 2,
    title: `L${d.line}: ${d.message}`,
  }))
}

function lintMarkersContentHeight(code: string): number {
  const lines = code.length === 0 ? 1 : code.split('\n').length
  return LINT_PAD_TOP_PX + lines * LINT_LINE_HEIGHT_PX + LINT_PAD_TOP_PX
}
