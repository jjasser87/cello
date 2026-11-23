import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildFlowGraph, toMermaid } from '../lib/flowGraph'
import {
  DEFAULT_FLOW_MODE,
  applyFlowMermaidEdit,
  isCustomFlow,
  resetFlowMermaid,
  resolveFlowMermaid,
  type FlowMermaidCustom,
  type FlowMode,
} from '../lib/flowMermaid'
import {
  cellIdFromFlowEventTarget,
  renderMermaidSvg,
  syncFlowNodeFocusMarks,
} from '../lib/mermaidRuntime'
import type { Cell, KernelLanguage } from '../types'

interface FlowGraphProps {
  cells: Cell[]
  language: KernelLanguage
  activeCellId: string
  /** null = auto; string = custom-locked Mermaid source. */
  flowMermaid: FlowMermaidCustom
  onFlowMermaidChange: (next: FlowMermaidCustom) => void
  onSelect: (cellId: string) => void
}

type PreviewState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; svg: string; usedFallback: boolean; error?: string }
  | { status: 'error'; error: string }

export function FlowGraphView({
  cells,
  language,
  activeCellId,
  flowMermaid,
  onFlowMermaidChange,
  onSelect,
}: FlowGraphProps) {
  const [mode, setMode] = useState<FlowMode>(DEFAULT_FLOW_MODE)
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const renderId = useId().replace(/:/g, '')
  const hostRef = useRef<HTMLDivElement>(null)
  const expandHostRef = useRef<HTMLDivElement>(null)

  const autoGraph = useMemo(() => buildFlowGraph(cells, language), [cells, language])
  const autoMermaid = useMemo(
    () => toMermaid(autoGraph.nodes, autoGraph.edges, activeCellId),
    [autoGraph.nodes, autoGraph.edges, activeCellId],
  )
  const custom = isCustomFlow(flowMermaid)
  const source = resolveFlowMermaid(autoMermaid, flowMermaid)

  useEffect(() => {
    if (mode !== 'preview' || cells.length === 0) return

    let cancelled = false
    const run = async () => {
      setPreview({ status: 'loading' })
      const primaryId = `cello-flow-${renderId}`
      const primary = await renderMermaidSvg(primaryId, source)

      if (cancelled) return

      if (primary.ok) {
        setPreview({
          status: 'ready',
          svg: primary.svg,
          usedFallback: false,
        })
        return
      }

      // Custom chart parse/render failure → show error + fall back to auto so
      // the panel never goes blank.
      if (custom) {
        const fallbackId = `cello-flow-auto-${renderId}`
        const fallback = await renderMermaidSvg(fallbackId, autoMermaid)
        if (cancelled) return
        if (fallback.ok) {
          setPreview({
            status: 'ready',
            svg: fallback.svg,
            usedFallback: true,
            error: primary.error,
          })
          return
        }
        setPreview({
          status: 'error',
          error: `${primary.error} (auto fallback also failed: ${fallback.error})`,
        })
        return
      }

      setPreview({ status: 'error', error: primary.error })
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [mode, source, autoMermaid, custom, cells.length, renderId])

  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    if (preview.status !== 'ready') return
    const hosts = [hostRef.current, expandHostRef.current].filter(Boolean) as HTMLDivElement[]
    for (const host of hosts) {
      syncFlowNodeFocusMarks(host, activeCellId)
    }

    const cleanups: Array<() => void> = []
    for (const host of hosts) {
      const onActivate = (event: Event) => {
        if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') {
          return
        }
        const cellId = cellIdFromFlowEventTarget(host, event.target)
        if (!cellId) return
        event.preventDefault()
        event.stopPropagation()
        onSelectRef.current(cellId)
      }
      host.addEventListener('click', onActivate)
      host.addEventListener('keydown', onActivate)
      cleanups.push(() => {
        host.removeEventListener('click', onActivate)
        host.removeEventListener('keydown', onActivate)
      })
    }
    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }, [preview, activeCellId, expanded])

  useEffect(() => {
    if (!expanded) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  if (cells.length === 0) {
    return <div className="empty-state">No cells yet. Add one to see Flow.</div>
  }

  const handleEdit = (text: string) => {
    onFlowMermaidChange(applyFlowMermaidEdit(text, autoMermaid))
  }

  const handleReset = () => {
    onFlowMermaidChange(resetFlowMermaid())
    setMode('preview')
  }

  const zoomOut = () => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))
  const zoomIn = () => setZoom((z) => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))
  const zoomReset = () => setZoom(1)

  return (
    <div className="flow-graph">
      <div className="flow-toolbar">
        <div className="flow-mode" role="group" aria-label="Flow mode">
          <button
            type="button"
            className={mode === 'edit' ? 'is-active' : ''}
            aria-pressed={mode === 'edit'}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
          <button
            type="button"
            className={mode === 'preview' ? 'is-active' : ''}
            aria-pressed={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            Preview
          </button>
        </div>
        <span className="mono muted small flow-source-badge">
          {custom ? 'custom · Mermaid' : 'auto · Mermaid TD'}
        </span>
        {custom ? (
          <button
            type="button"
            className="flow-reset"
            onClick={handleReset}
            title="Discard edits and regenerate from cells"
          >
            Reset to auto
          </button>
        ) : null}
      </div>

      {mode === 'edit' ? (
        <textarea
          className="flow-editor"
          value={source}
          onChange={(event) => handleEdit(event.target.value)}
          spellCheck={false}
          aria-label="Flow Mermaid source"
          placeholder={'flowchart TD\n  n_a["1. Cell"]\n  n_a --> n_b'}
        />
      ) : (
        <>
          {preview.status === 'ready' && preview.error ? (
            <div className="flow-parse-error" role="alert">
              Custom chart invalid — showing auto graph. {preview.error}
            </div>
          ) : null}
          {preview.status === 'error' ? (
            <div className="flow-parse-error" role="alert">
              {preview.error}
            </div>
          ) : null}

          <div className="flow-preview-tools">
            <button type="button" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
              −
            </button>
            <button type="button" onClick={zoomReset} title="Reset zoom" aria-label="Reset zoom">
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
              +
            </button>
            <button
              type="button"
              className="flow-expand-btn"
              onClick={() => setExpanded(true)}
              title="Expand chart"
            >
              Expand
            </button>
          </div>

          <div
            className="flow-canvas flow-canvas-mermaid"
            role="img"
            aria-label="Cell connection graph"
          >
            {preview.status === 'loading' || preview.status === 'idle' ? (
              <div className="empty-state">Rendering Flow…</div>
            ) : preview.status === 'ready' ? (
              <div className="flow-mermaid-scroll">
                <div
                  ref={hostRef}
                  className="flow-mermaid-host"
                  style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                  dangerouslySetInnerHTML={{ __html: preview.svg }}
                />
              </div>
            ) : (
              <div className="empty-state">No graph to preview.</div>
            )}
          </div>
        </>
      )}

      {expanded && preview.status === 'ready'
        ? createPortal(
            <div className="flow-expand-overlay" role="dialog" aria-modal="true" aria-label="Expanded Flow chart">
              <div className="flow-expand-panel">
                <div className="flow-expand-toolbar">
                  <span className="mono muted small">
                    {custom && !preview.usedFallback ? 'custom' : 'auto'} · Mermaid
                  </span>
                  <div className="flow-preview-tools">
                    <button type="button" onClick={zoomOut} aria-label="Zoom out">
                      −
                    </button>
                    <button type="button" onClick={zoomReset} aria-label="Reset zoom">
                      {Math.round(zoom * 100)}%
                    </button>
                    <button type="button" onClick={zoomIn} aria-label="Zoom in">
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="flow-expand-close"
                    onClick={() => setExpanded(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="flow-expand-scroll">
                  <div
                    ref={expandHostRef}
                    className="flow-mermaid-host"
                    style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
                    dangerouslySetInnerHTML={{ __html: preview.svg }}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
