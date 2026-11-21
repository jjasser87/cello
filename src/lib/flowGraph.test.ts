import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFlowGraph,
  extractDefs,
  extractUses,
  toMermaid,
} from './flowGraph.ts'
import type { Cell } from '../types.ts'

function cell(partial: Partial<Cell> & Pick<Cell, 'id' | 'name' | 'code'>): Cell {
  return {
    status: 'idle',
    ...partial,
  }
}

describe('extractDefs / extractUses', () => {
  it('finds JS const/let defs and uses', () => {
    const code = `const sales = [1];\nconst total = sales.reduce((a, b) => a + b, 0);`
    const defs = extractDefs(code, 'javascript')
    const uses = extractUses(code, 'javascript')
    assert.ok(defs.has('sales'))
    assert.ok(defs.has('total'))
    assert.ok(uses.has('sales'))
  })

  it('finds R assignment defs without named args', () => {
    const code = `sales <- data.frame(month = c("Jan"), revenue = c(1))\ntotal <- sum(sales$revenue)`
    const defs = extractDefs(code, 'r')
    assert.ok(defs.has('sales'))
    assert.ok(defs.has('total'))
    assert.equal(defs.has('month'), false)
    assert.equal(defs.has('revenue'), false)
  })
})

describe('buildFlowGraph', () => {
  it('emits order edges for consecutive cells', () => {
    const cells = [
      cell({ id: 'a', name: 'Load', code: 'const sales = 1;' }),
      cell({ id: 'b', name: 'Sum', code: 'const total = sales + 1;' }),
      cell({ id: 'c', name: 'Plot', code: 'cello.plot({ values: [total] });' }),
    ]
    const graph = buildFlowGraph(cells, 'javascript')
    assert.equal(graph.nodes.length, 3)
    const order = graph.edges.filter((e) => e.kind === 'order')
    assert.deepEqual(
      order.map((e) => `${e.from}->${e.to}`),
      ['a->b', 'b->c'],
    )
  })

  it('adds depends edges when later cells use earlier defs', () => {
    const cells = [
      cell({ id: 'a', name: 'Load', code: 'const sales = [{ month: "Jan" }];' }),
      cell({ id: 'b', name: 'Sum', code: 'const n = sales.length;' }),
      cell({ id: 'c', name: 'Other', code: 'const x = 1;' }),
    ]
    const graph = buildFlowGraph(cells, 'javascript')
    const depends = graph.edges.filter((e) => e.kind === 'depends')
    assert.ok(depends.some((e) => e.from === 'a' && e.to === 'b' && e.symbols?.includes('sales')))
  })

  it('regenerates Mermaid with current-cell class', () => {
    const cells = [
      cell({ id: 'a', name: 'One', code: 'const a = 1;' }),
      cell({ id: 'b', name: 'Two', code: 'const b = a;' }),
    ]
    const graph = buildFlowGraph(cells, 'javascript')
    const src = toMermaid(graph.nodes, graph.edges, 'b')
    assert.match(src, /flowchart TD/)
    assert.match(src, /n_a --> n_b/)
    assert.match(src, /class n_b current/)
  })

  it('rebuilds when cells are reordered', () => {
    const cells = [
      cell({ id: 'a', name: 'A', code: 'const a = 1;' }),
      cell({ id: 'b', name: 'B', code: 'const b = 2;' }),
    ]
    const forward = buildFlowGraph(cells, 'javascript')
    const reverse = buildFlowGraph([cells[1], cells[0]], 'javascript')
    assert.equal(forward.edges.find((e) => e.kind === 'order')?.from, 'a')
    assert.equal(reverse.edges.find((e) => e.kind === 'order')?.from, 'b')
    assert.notEqual(forward.mermaid, reverse.mermaid)
  })
})
