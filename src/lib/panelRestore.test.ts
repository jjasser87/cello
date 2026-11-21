import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  restoreCellCode,
  sourceCodeForConsole,
  sourceCodeForPlot,
  sourceCodeForTable,
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
