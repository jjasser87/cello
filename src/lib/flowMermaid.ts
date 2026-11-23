import type { CellStatus } from '../types'
import type { FlowEdge, FlowNode } from './flowGraph'

/** Default Flow panel mode when opening — mirrors Explain (Preview first). */
export const DEFAULT_FLOW_MODE = 'preview' as const

export type FlowMode = 'edit' | 'preview'

/**
 * Custom-lock rule:
 * - `null` / missing → auto mode: Mermaid is regenerated from cells on every change.
 * - non-null string → custom lock: user-edited Mermaid is kept until Reset to auto.
 * First keystroke that differs from the current auto source (or any explicit set)
 * engages the lock; Reset clears it back to `null`.
 */
export type FlowMermaidCustom = string | null

export function isCustomFlow(custom: FlowMermaidCustom | undefined): boolean {
  return typeof custom === 'string'
}

/** Source shown in Edit / used for Preview when custom; otherwise the auto text. */
export function resolveFlowMermaid(
  autoMermaid: string,
  custom: FlowMermaidCustom | undefined,
): string {
  return isCustomFlow(custom) ? (custom as string) : autoMermaid
}

/**
 * Apply an edit. Engages custom lock when the text differs from auto;
 * stays unlocked if the user only typed back to the exact auto source.
 */
export function applyFlowMermaidEdit(
  nextText: string,
  autoMermaid: string,
): FlowMermaidCustom {
  return nextText === autoMermaid ? null : nextText
}

/** Clear custom lock — caller should re-render from auto Mermaid. */
export function resetFlowMermaid(): FlowMermaidCustom {
  return null
}

export type ParsedMermaidGraph = {
  ok: true
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export type ParsedMermaidError = {
  ok: false
  error: string
}

export type ParseMermaidResult = ParsedMermaidGraph | ParsedMermaidError

/**
 * Parse a Mermaid flowchart TD/LR source into Flow nodes/edges for the SVG
 * preview. Supports the subset emitted by `toMermaid` plus common edits:
 * node shapes `id["label"]` / `id[label]`, solid `-->` and dotted `-.->`
 * edges (optional `|label|`), and `class` / `classDef` (ignored for layout).
 */
export function parseMermaidFlowchart(
  source: string,
  opts?: { activeCellId?: string; cellStatuses?: Record<string, CellStatus> },
): ParseMermaidResult {
  const text = source.replace(/\r\n/g, '\n').trim()
  if (!text) {
    return { ok: false, error: 'Empty Mermaid source.' }
  }

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  const header = lines[0]?.toLowerCase() ?? ''
  if (!/^(flowchart|graph)\s+(td|tb|bt|rl|lr)\b/.test(header) && !/^(flowchart|graph)\b/.test(header)) {
    return { ok: false, error: 'Expected a Mermaid flowchart (e.g. flowchart TD).' }
  }

  const body = lines.slice(1)
  const nodeOrder: string[] = []
  const labels = new Map<string, string>()
  const edges: FlowEdge[] = []
  const edgeKey = new Set<string>()

  const ensureNode = (id: string, label?: string) => {
    if (!labels.has(id)) {
      labels.set(id, label ?? id)
      nodeOrder.push(id)
    } else if (label !== undefined) {
      labels.set(id, label)
    }
  }

  const addEdge = (from: string, to: string, kind: FlowEdge['kind'], symbols?: string[]) => {
    const key = `${kind}:${from}->${to}:${(symbols ?? []).join(',')}`
    if (edgeKey.has(key)) return
    edgeKey.add(key)
    edges.push({ from, to, kind, symbols })
  }

  for (const raw of body) {
    const line = stripMermaidComment(raw)
    if (!line) continue
    if (/^classDef\b/i.test(line) || /^class\b/i.test(line) || /^style\b/i.test(line)) {
      continue
    }
    if (/^linkStyle\b/i.test(line) || /^%%/.test(line)) continue

    const nodeDef = line.match(/^([A-Za-z_][\w-]*)\s*(\[\[|\[|\(\(|\(|\{\{|\{)(.*)(\]\]|\]|\)\)|\)|\}\}|\})\s*$/)
    if (nodeDef && !/\s-->/.test(line) && !/\s-\.->/.test(line) && !/\s---/.test(line)) {
      const id = nodeDef[1]
      const label = unwrapMermaidLabel(nodeDef[3])
      ensureNode(id, label)
      continue
    }

    const edgeMatch = line.match(
      /^([A-Za-z_][\w-]*)(?:\s*(?:\[\[|\[|\(\(|\(|\{\{|\{)(.*?)(?:\]\]|\]|\)\)|\)|\}\}|\})\s*)?\s*(-->|---|-\.->|==>)\s*(?:\|([^|]+)\|)?\s*([A-Za-z_][\w-]*)(?:\s*(?:\[\[|\[|\(\(|\(|\{\{|\{)(.*?)(?:\]\]|\]|\)\)|\)|\}\}|\})\s*)?$/,
    )
    if (edgeMatch) {
      const from = edgeMatch[1]
      const fromLabel = edgeMatch[2] !== undefined ? unwrapMermaidLabel(edgeMatch[2]) : undefined
      const arrow = edgeMatch[3]
      const edgeLabel = edgeMatch[4]?.trim()
      const to = edgeMatch[5]
      const toLabel = edgeMatch[6] !== undefined ? unwrapMermaidLabel(edgeMatch[6]) : undefined
      ensureNode(from, fromLabel)
      ensureNode(to, toLabel)
      const kind: FlowEdge['kind'] = arrow === '-.->' ? 'depends' : 'order'
      const symbols = edgeLabel
        ? edgeLabel.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4)
        : undefined
      addEdge(from, to, kind, symbols)
      continue
    }

    // Soft-fail unknown directives rather than aborting the whole chart.
    if (/^(subgraph|end|direction)\b/i.test(line)) continue
  }

  if (nodeOrder.length === 0) {
    return { ok: false, error: 'No nodes found in Mermaid source.' }
  }

  const statuses = opts?.cellStatuses ?? {}
  const nodes: FlowNode[] = nodeOrder.map((id, index) => {
    const cellId = mermaidIdToCellId(id)
    return {
      id,
      label: labels.get(id) ?? id,
      index,
      status: (cellId && statuses[cellId]) || 'idle',
    }
  })

  return { ok: true, nodes, edges }
}

/** Map `n_cell_abc` Mermaid ids back to cell ids when possible. */
export function mermaidIdToCellId(mermaidId: string): string | null {
  if (mermaidId.startsWith('n_')) {
    return mermaidId.slice(2)
  }
  return null
}

/**
 * Resolve which cell a Flow node click should select.
 * Prefers Mermaid id → cell id, then exact label match, then "N. name" prefix.
 */
export function cellIdForFlowNode(
  nodeId: string,
  label: string,
  cells: { id: string; name: string }[],
): string | null {
  const fromId = mermaidIdToCellId(nodeId)
  if (fromId && cells.some((c) => c.id === fromId)) return fromId

  const exact = cells.find((c) => c.id === nodeId)
  if (exact) return exact.id

  const byName = cells.find((c) => c.name === label || label.endsWith(c.name))
  if (byName) return byName.id

  const numbered = label.match(/^\d+\.\s*(.+)$/)
  if (numbered) {
    const name = numbered[1]
    const hit = cells.find((c) => c.name === name)
    if (hit) return hit.id
  }

  return null
}

function stripMermaidComment(line: string): string {
  const idx = line.indexOf('%%')
  if (idx === 0) return ''
  if (idx > 0) return line.slice(0, idx).trim()
  return line
}

function unwrapMermaidLabel(raw: string): string {
  let text = raw.trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1)
  }
  return text
}
