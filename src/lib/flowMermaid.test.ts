import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildFlowGraph, toMermaid } from './flowGraph.ts'
import {
  DEFAULT_FLOW_MODE,
  applyFlowMermaidEdit,
  cellIdForFlowNode,
  isCustomFlow,
  parseMermaidFlowchart,
  resetFlowMermaid,
  resolveFlowMermaid,
} from './flowMermaid.ts'
import type { Cell } from '../types.ts'

function cell(partial: Partial<Cell> & Pick<Cell, 'id' | 'name' | 'code'>): Cell {
  return {
    status: 'idle',
    explanation: '',
    comments: [],
    ...partial,
  }
}

describe('flow Mermaid custom lock', () => {
  it('defaults to Preview mode', () => {
    assert.equal(DEFAULT_FLOW_MODE, 'preview')
  })

  it('null means auto; string means custom lock', () => {
    assert.equal(isCustomFlow(null), false)
    assert.equal(isCustomFlow(undefined), false)
    assert.equal(isCustomFlow('flowchart TD\n'), true)
    assert.equal(isCustomFlow(''), true)
  })

  it('resolve prefers custom when locked, else auto', () => {
    assert.equal(resolveFlowMermaid('auto', null), 'auto')
    assert.equal(resolveFlowMermaid('auto', 'custom'), 'custom')
  })

  it('edit engages lock only when text differs from auto', () => {
    const auto = 'flowchart TD\n  a --> b\n'
    assert.equal(applyFlowMermaidEdit(auto, auto), null)
    assert.equal(applyFlowMermaidEdit('flowchart TD\n  a --> c\n', auto), 'flowchart TD\n  a --> c\n')
  })

  it('reset clears custom lock', () => {
    assert.equal(resetFlowMermaid(), null)
  })

  it('custom lock survives a newer auto source (not silently wiped)', () => {
    const auto1 = 'flowchart TD\n  a --> b\n'
    const custom = applyFlowMermaidEdit('flowchart TD\n  a --> z\n', auto1)
    assert.ok(isCustomFlow(custom))
    const auto2 = 'flowchart TD\n  a --> b\n  b --> c\n'
    // Re-resolve with a regenerated auto — custom text must win until Reset.
    assert.equal(resolveFlowMermaid(auto2, custom), 'flowchart TD\n  a --> z\n')
    assert.equal(resolveFlowMermaid(auto2, resetFlowMermaid()), auto2)
  })
})

describe('parseMermaidFlowchart', () => {
  it('round-trips auto Mermaid from buildFlowGraph', () => {
    const cells = [
      cell({ id: 'cell_a', name: 'Load', code: 'sales <- 1' }),
      cell({ id: 'cell_b', name: 'Total', code: 'total <- sales + 1' }),
    ]
    const graph = buildFlowGraph(cells, 'r')
    const parsed = parseMermaidFlowchart(graph.mermaid)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.nodes.length, 2)
    assert.ok(parsed.edges.some((e) => e.kind === 'order'))
    assert.ok(parsed.edges.some((e) => e.kind === 'depends'))
  })

  it('parses solid and dotted edges with labels', () => {
    const src = [
      'flowchart TD',
      '  n_a["1. Load"]',
      '  n_b["2. Use"]',
      '  n_a --> n_b',
      '  n_a -.->|sales| n_b',
    ].join('\n')
    const parsed = parseMermaidFlowchart(src)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.nodes[0].label, '1. Load')
    assert.equal(parsed.edges.length, 2)
    const dep = parsed.edges.find((e) => e.kind === 'depends')
    assert.ok(dep)
    assert.deepEqual(dep?.symbols, ['sales'])
  })

  it('rejects empty / non-flowchart sources', () => {
    assert.equal(parseMermaidFlowchart('').ok, false)
    assert.equal(parseMermaidFlowchart('sequenceDiagram\n  A->>B: hi').ok, false)
  })

  it('maps node clicks back to cell ids', () => {
    const cells = [
      { id: 'cell_a', name: 'Load' },
      { id: 'cell_b', name: 'Plot' },
    ]
    assert.equal(cellIdForFlowNode('n_cell_a', '1. Load', cells), 'cell_a')
    assert.equal(cellIdForFlowNode('n_x', '2. Plot', cells), 'cell_b')
  })

  it('keeps classDef lines from toMermaid without failing', () => {
    const cells = [
      cell({ id: 'a', name: 'A', code: 'x <- 1' }),
      cell({ id: 'b', name: 'B', code: 'y <- 2' }),
    ]
    const graph = buildFlowGraph(cells, 'r')
    const withClass = toMermaid(graph.nodes, graph.edges, 'b')
    const parsed = parseMermaidFlowchart(withClass)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.nodes.length, 2)
  })
})
