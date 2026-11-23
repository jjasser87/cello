import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { Window } from 'happy-dom'
import { buildFlowGraph, toMermaid } from './flowGraph.ts'
import {
  TEST4_FLOW_MERMAID,
  test4FlowMermaidFeatures,
} from './fixtures/test4-flowMermaid.ts'
import {
  cellIdFromMermaidNodeId,
  mermaidNodeIdFromDomId,
  parseMermaidSource,
  resetMermaidRuntimeForTests,
} from './mermaidRuntime.ts'
import type { Cell } from '../types.ts'

function installDom(): void {
  const window = new Window({ url: 'https://localhost/' })
  const assign = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    })
  }
  assign('window', window)
  assign('document', window.document)
  assign('HTMLElement', window.HTMLElement)
  assign('SVGElement', window.SVGElement)
  assign('Element', window.Element)
  assign('Node', window.Node)
  assign('DocumentFragment', window.DocumentFragment)
  assign('DOMParser', window.DOMParser)
  assign('XMLSerializer', window.XMLSerializer)
  assign('getComputedStyle', window.getComputedStyle.bind(window))
  assign('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0))
  assign('cancelAnimationFrame', (id: number) => clearTimeout(id))
  try {
    assign('navigator', window.navigator)
  } catch {
    /* Node may expose a read-only navigator */
  }
}

function cell(partial: Partial<Cell> & Pick<Cell, 'id' | 'name' | 'code'>): Cell {
  return {
    status: 'idle',
    explanation: '',
    comments: [],
    ...partial,
  }
}

describe('mermaidRuntime + fixtures', () => {
  before(() => {
    installDom()
    resetMermaidRuntimeForTests()
  })

  it('parses toMermaid() auto output with Mermaid v11', async () => {
    const cells = [
      cell({ id: 'cell_a', name: 'Load', code: 'sales <- 1' }),
      cell({ id: 'cell_b', name: 'Total', code: 'total <- sales + 1' }),
    ]
    const graph = buildFlowGraph(cells, 'r')
    const src = toMermaid(graph.nodes, graph.edges, 'cell_b')
    assert.match(src, /flowchart TD/)
    assert.match(src, /n_cell_a/)
    assert.match(src, /-\.->/)
    assert.match(src, /class n_cell_b current/)

    const parsed = await parseMermaidSource(src)
    assert.equal(parsed.ok, true, parsed.ok === false ? parsed.error : '')
  })

  it('parses test 4 flowMermaid fixture (subgraphs, style, dotted, invisible)', async () => {
    const features = test4FlowMermaidFeatures(TEST4_FLOW_MERMAID)
    assert.equal(features.hasSubgraph, true)
    assert.equal(features.hasStyle, true)
    assert.equal(features.hasDottedArrow, true)
    assert.equal(features.hasInvisibleLink, true)
    assert.equal(features.hasBrBreak, true)

    const parsed = await parseMermaidSource(TEST4_FLOW_MERMAID)
    assert.equal(parsed.ok, true, parsed.ok === false ? parsed.error : '')
  })

  it('rejects invalid Mermaid so callers can fall back to auto', async () => {
    const parsed = await parseMermaidSource('not a diagram')
    assert.equal(parsed.ok, false)
    if (parsed.ok) return
    assert.ok(parsed.error.length > 0)
  })

  it('extracts n_cell_* ids from Mermaid DOM ids for click-to-focus', () => {
    assert.equal(mermaidNodeIdFromDomId('flowchart-n_cell_abc123-0'), 'n_cell_abc123')
    assert.equal(mermaidNodeIdFromDomId('flowchart-n_cell_abc123-12'), 'n_cell_abc123')
    assert.equal(
      mermaidNodeIdFromDomId('cello-flow-_r_0_-flowchart-n_cell_mz51if5-0'),
      'n_cell_mz51if5',
    )
    assert.equal(mermaidNodeIdFromDomId('flowchart-other-0'), null)
    assert.equal(cellIdFromMermaidNodeId('n_cell_abc123'), 'cell_abc123')
  })
})
