import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyCodeHistoryRevert,
  applyTypedHistoryRevert,
  restoreCellCode,
  sourceCodeForConsole,
  sourceCodeForPlot,
  sourceCodeForTable,
  truncateCellSeries,
} from './panelRestore.ts'
import type { Cell, ConsoleEntry, DataTable, HistoryEntry, PlotSpec } from '../types.ts'

function cell(partial: Partial<Cell> & Pick<Cell, 'id' | 'name' | 'code'>): Cell {
  return {
    status: 'ok',
    explanation: '',
    comments: [],
    ...partial,
  }
}

describe('restoreCellCode', () => {
  it('restores only the target cell and clears run status', () => {
    const cells = [
      cell({ id: 'a', name: 'A', code: 'old', status: 'error', error: 'x' }),
      cell({ id: 'b', name: 'B', code: 'keep' }),
    ]
    const next = restoreCellCode(cells, 'a', 'restored')
    assert.equal(next[0].code, 'restored')
    assert.equal(next[0].status, 'idle')
    assert.equal(next[0].error, undefined)
    assert.equal(next[1].code, 'keep')
  })
})

describe('sourceCodeFor*', () => {
  const history: HistoryEntry[] = [
    {
      id: 'h1',
      cellId: 'c1',
      cellName: 'Cell',
      code: 'from-history',
      previousCode: '',
      timestamp: 1,
      status: 'ok',
      plotId: 'p1',
      dataId: 't1',
    },
  ]

  it('prefers sourceCode stamped on the artifact', () => {
    const plot: PlotSpec = {
      id: 'p1',
      cellId: 'c1',
      title: 'A',
      kind: 'bar',
      labels: [],
      values: [],
      createdAt: 1,
      sourceCode: 'stamped',
      historyId: 'h1',
    }
    assert.equal(sourceCodeForPlot(plot, history), 'stamped')
  })

  it('falls back to historyId / linked plotId', () => {
    const plot: PlotSpec = {
      id: 'p1',
      cellId: 'c1',
      title: 'A',
      kind: 'bar',
      labels: [],
      values: [],
      createdAt: 1,
    }
    assert.equal(sourceCodeForPlot(plot, history), 'from-history')
    const table: DataTable = {
      id: 't1',
      cellId: 'c1',
      name: 'sales',
      columns: [],
      rows: [],
      createdAt: 1,
      historyId: 'h1',
    }
    assert.equal(sourceCodeForTable(table, history), 'from-history')
  })

  it('resolves console entry source', () => {
    const entry: ConsoleEntry = {
      id: 'co1',
      cellId: 'c1',
      text: 'hi',
      timestamp: 1,
      status: 'ok',
      sourceCode: 'console-src',
    }
    assert.equal(sourceCodeForConsole(entry, history), 'console-src')
  })
})

describe('truncateCellSeries / revert', () => {
  it('keeps through keepId and drops newer for that cell only', () => {
    const items = [
      { id: 'a1', cellId: 'a' },
      { id: 'b1', cellId: 'b' },
      { id: 'a2', cellId: 'a' },
      { id: 'a3', cellId: 'a' },
      { id: 'b2', cellId: 'b' },
    ]
    const next = truncateCellSeries(items, 'a', 'a2')
    assert.deepEqual(
      next.map((i) => i.id),
      ['a1', 'b1', 'a2', 'b2'],
    )
  })

  it('applyCodeHistoryRevert restores code and truncates forward + linked plots', () => {
    const cells = [
      cell({ id: 'c1', name: 'A', code: 'latest' }),
      cell({ id: 'c2', name: 'B', code: 'other' }),
    ]
    const history: HistoryEntry[] = [
      {
        id: 'h1',
        cellId: 'c1',
        cellName: 'A',
        code: 'v1',
        previousCode: '',
        timestamp: 1,
        status: 'ok',
        plotId: 'p1',
      },
      {
        id: 'h2',
        cellId: 'c1',
        cellName: 'A',
        code: 'v2',
        previousCode: 'v1',
        timestamp: 2,
        status: 'ok',
        plotId: 'p2',
      },
      {
        id: 'h3',
        cellId: 'c2',
        cellName: 'B',
        code: 'x',
        previousCode: '',
        timestamp: 3,
        status: 'ok',
      },
    ]
    const plots: PlotSpec[] = [
      {
        id: 'p1',
        cellId: 'c1',
        title: 'P1',
        kind: 'bar',
        labels: [],
        values: [],
        createdAt: 1,
        historyId: 'h1',
      },
      {
        id: 'p2',
        cellId: 'c1',
        title: 'P2',
        kind: 'bar',
        labels: [],
        values: [],
        createdAt: 2,
        historyId: 'h2',
      },
    ]
    const next = applyCodeHistoryRevert(
      {
        cells,
        history,
        plots,
        tables: [],
        consoleEntries: [],
        activePlotId: 'p2',
        activeTableId: null,
        activeConsoleId: null,
      },
      'h1',
    )
    assert.ok(next)
    assert.equal(next.cells[0].code, 'v1')
    assert.deepEqual(
      next.history.map((h) => h.id),
      ['h1', 'h3'],
    )
    assert.deepEqual(
      next.plots.map((p) => p.id),
      ['p1'],
    )
    assert.equal(next.activePlotId, 'p1')
  })

  it('applyTypedHistoryRevert truncates plot series and restores stamped code', () => {
    const cells = [cell({ id: 'c1', name: 'A', code: 'new' })]
    const plots: PlotSpec[] = [
      {
        id: 'p1',
        cellId: 'c1',
        title: 'P1',
        kind: 'bar',
        labels: [],
        values: [],
        createdAt: 1,
        sourceCode: 'old-plot',
      },
      {
        id: 'p2',
        cellId: 'c1',
        title: 'P2',
        kind: 'bar',
        labels: [],
        values: [],
        createdAt: 2,
        sourceCode: 'new-plot',
      },
    ]
    const next = applyTypedHistoryRevert({
      items: plots,
      keepId: 'p1',
      cellId: 'c1',
      sourceCode: 'old-plot',
      cells,
      history: [],
    })
    assert.ok(next)
    assert.equal(next.items.length, 1)
    assert.equal(next.items[0].id, 'p1')
    assert.equal(next.cells[0].code, 'old-plot')
  })
})
