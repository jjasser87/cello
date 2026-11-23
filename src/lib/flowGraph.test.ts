import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFlowGraph,
  extractDefs,
  extractUses,
  maskColumnAccess,
  toMermaid,
} from './flowGraph.ts'
import type { Cell } from '../types.ts'

function cell(partial: Partial<Cell> & Pick<Cell, 'id' | 'name' | 'code'>): Cell {
  return {
    status: 'idle',
    explanation: '',
    comments: [],
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

  it('does not treat df$col / [[ / [ column names as free uses', () => {
    const code = `total <- sum(df$salaries) + mean(df[["bonus"]]) + max(df[rows, salaries])`
    const uses = extractUses(code, 'r')
    assert.ok(uses.has('df'))
    assert.ok(uses.has('rows'))
    assert.equal(uses.has('salaries'), false)
    assert.equal(uses.has('bonus'), false)
    const masked = maskColumnAccess('df$salaries + df[[x]]', 'r')
    assert.equal(/\bsalaries\b/.test(masked), false)
  })

  it('does not treat aes() column mappings as free uses', () => {
    const code = `ggplot(data = df, mapping = aes(y = salaries)) + geom_boxplot()`
    const uses = extractUses(code, 'r')
    assert.ok(uses.has('df'))
    assert.equal(uses.has('salaries'), false)
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

  it('repro: salaries column in ggplot aes is not a Flow edge to the salaries vector cell', () => {
    // Cell codes from internal/repro-flow-salaries/cello.json
    const cells = [
      cell({ id: 'cell_6gl4wh1', name: 'Load Libraries', code: 'library(ggplot2)' }),
      cell({
        id: 'cell_rhokyw2',
        name: 'Create random data',
        code: 'emp_ids <- 1:1000\nsalaries <- rnorm(1000, mean = 66000, sd = 30000)',
      }),
      cell({
        id: 'cell_jpnve1w',
        name: 'Create Data Frame',
        code: 'df <- data.frame(\n  ids = emp_ids, salaries = floor(salaries)\n)',
      }),
      cell({
        id: 'cell_uv0xv8h',
        name: 'Plot boxplot',
        code: 'ggplot(\n  data = df,\n  mapping = aes(y = salaries)\n) +\n  geom_boxplot()',
      }),
      cell({
        id: 'cell_kl6vhqr',
        name: 'Plot histogram',
        code: 'ggplot(\n  data = df,\n  mapping = aes(x = salaries)\n) +\n  geom_histogram()',
      }),
    ]
    const graph = buildFlowGraph(cells, 'r')
    const depends = graph.edges.filter((e) => e.kind === 'depends')

    // Data frame cell still depends on the salaries *vector* (RHS of floor(salaries)).
    assert.ok(
      depends.some(
        (e) =>
          e.from === 'cell_rhokyw2' &&
          e.to === 'cell_jpnve1w' &&
          e.symbols?.includes('salaries'),
      ),
    )

    // Plot cells depend on df only — not on the earlier salaries vector.
    for (const plotId of ['cell_uv0xv8h', 'cell_kl6vhqr']) {
      const plotDepends = depends.filter((e) => e.to === plotId)
      assert.ok(plotDepends.some((e) => e.from === 'cell_jpnve1w' && e.symbols?.includes('df')))
      assert.equal(
        plotDepends.some((e) => e.symbols?.includes('salaries')),
        false,
        `plot ${plotId} should not depend on salaries column as a free var`,
      )
      assert.equal(
        plotDepends.some((e) => e.from === 'cell_rhokyw2'),
        false,
      )
    }
  })
})
