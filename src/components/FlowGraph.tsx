import { useMemo } from 'react'
import {
  buildFlowGraph,
  toMermaid,
  type FlowEdge,
  type FlowNode,
} from '../lib/flowGraph'
import type { Cell, KernelLanguage } from '../types'

interface FlowGraphProps {
  cells: Cell[]
  language: KernelLanguage
  activeCellId: string
  onSelect: (cellId: string) => void
}

const NODE_W = 200
const NODE_H = 36
const V_GAP = 28
const PAD_X = 24
const PAD_Y = 12

export function FlowGraphView({ cells, language, activeCellId, onSelect }: FlowGraphProps) {
  const graph = useMemo(() => buildFlowGraph(cells, language), [cells, language])
  const mermaid = useMemo(
    () => toMermaid(graph.nodes, graph.edges, activeCellId),
    [graph.nodes, graph.edges, activeCellId],
  )
  const layout = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph.nodes, graph.edges])

  if (cells.length === 0) {
    return <div className="empty-state">No cells yet. Add one to see Flow.</div>
  }

  return (
    <div className="flow-graph">
      <div className="structure-file">
        <span className="mono">auto · Mermaid TD</span>
      </div>

      <div className="flow-canvas" role="img" aria-label="Cell connection graph">
        <svg
          className="flow-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width="100%"
          height={layout.height}
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow-head" />
            </marker>
            <marker
              id="flow-arrow-dep"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow-head-dep" />
            </marker>
          </defs>

          {layout.edges.map((edge) => (
            <g key={edge.key}>
              <path
                d={edge.d}
                className={`flow-edge flow-edge-${edge.kind}`}
                markerEnd={edge.kind === 'order' ? 'url(#flow-arrow)' : 'url(#flow-arrow-dep)'}
                fill="none"
              />
              {edge.label ? (
                <text x={edge.labelX} y={edge.labelY} className="flow-edge-label">
                  {edge.label}
                </text>
              ) : null}
            </g>
          ))}

          {layout.nodes.map((node) => {
            const current = node.id === activeCellId
            return (
              <g
                key={node.id}
                className={`flow-node ${current ? 'is-current' : ''} status-${node.status}`}
                transform={`translate(${node.x}, ${node.y})`}
              >
                <title>{node.label}</title>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx="8"
                  ry="8"
                  className="flow-node-shape"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(node.id)
                    }
                  }}
                />
                <text
                  x={NODE_W / 2}
                  y={NODE_H / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="flow-node-label"
                  onClick={() => onSelect(node.id)}
                >
                  {truncate(node.label, 28)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <details className="flow-mermaid-source">
        <summary>Mermaid source</summary>
        <pre className="mono">{mermaid}</pre>
      </details>
    </div>
  )
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

interface LaidNode extends FlowNode {
  x: number
  y: number
  cx: number
  cy: number
}

interface LaidEdge {
  key: string
  kind: 'order' | 'depends'
  d: string
  label?: string
  labelX: number
  labelY: number
}

function layoutGraph(nodes: FlowNode[], edges: FlowEdge[]) {
  const laid: LaidNode[] = nodes.map((node, index) => {
    const x = PAD_X
    const y = PAD_Y + index * (NODE_H + V_GAP)
    return {
      ...node,
      x,
      y,
      cx: x + NODE_W / 2,
      cy: y + NODE_H / 2,
    }
  })

  const byId = new Map(laid.map((n) => [n.id, n]))
  const width = PAD_X * 2 + NODE_W + 48
  const height = PAD_Y * 2 + nodes.length * NODE_H + Math.max(0, nodes.length - 1) * V_GAP

  const laidEdges: LaidEdge[] = []
  let depOffset = 0

  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue

    if (edge.kind === 'order' && Math.abs(from.index - to.index) === 1) {
      const x = from.cx
      const y1 = from.y + NODE_H
      const y2 = to.y
      laidEdges.push({
        key: `order:${edge.from}->${edge.to}`,
        kind: 'order',
        d: `M ${x} ${y1} L ${x} ${y2}`,
        labelX: x,
        labelY: (y1 + y2) / 2,
      })
      continue
    }

    // Dependency arcs swing to the right so they don't bury order arrows.
    depOffset += 1
    const swing = 18 + (depOffset % 4) * 10
    const x1 = from.x + NODE_W
    const y1 = from.cy
    const x2 = to.x + NODE_W
    const y2 = to.cy
    const cx = Math.max(x1, x2) + swing
    const label = (edge.symbols ?? []).slice(0, 2).join(', ')
    laidEdges.push({
      key: `depends:${edge.from}->${edge.to}:${label}`,
      kind: 'depends',
      d: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
      label: label || undefined,
      labelX: cx + 2,
      labelY: (y1 + y2) / 2,
    })
  }

  const depExtra = laidEdges.some((e) => e.kind === 'depends') ? 56 : 0
  return {
    nodes: laid,
    edges: laidEdges,
    width: Math.max(width, PAD_X * 2 + NODE_W + 48 + depExtra),
    height,
  }
}
