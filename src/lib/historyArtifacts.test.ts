import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { historyArtifactLabel, resolveHistoryArtifacts } from './historyArtifacts.ts'
import type { DataTable, HistoryEntry, PlotSpec } from '../types.ts'

function entry(partial: Partial<HistoryEntry> & Pick<HistoryEntry, 'id' | 'cellId'>): HistoryEntry {
  return {
    cellName: 'Cell',
    code: 'x',
    previousCode: '',
    timestamp: 1,
    status: 'ok',
    ...partial,
  }
}

describe('resolveHistoryArtifacts', () => {
  const plots: PlotSpec[] = [
    {
      id: 'plot-1',
      cellId: 'c1',
      title: 'A',
      kind: 'bar',
      labels: ['a'],
      values: [1],
      createdAt: 1,
    },
    {
      id: 'plot-2',
      cellId: 'c2',
      title: 'Other cell',
      kind: 'line',
      labels: ['b'],
      values: [2],
      createdAt: 2,
    },
  ]
  const tables: DataTable[] = [
    {
      id: 'tbl-1',
      cellId: 'c1',
      name: 'sales',
      columns: ['month'],
      rows: [{ month: 'Jan' }],
      createdAt: 1,
    },
  ]

  it('returns console, plot, and data for a full run', () => {
    const result = resolveHistoryArtifacts(
      entry({
        id: 'h1',
        cellId: 'c1',
        outputText: 'hello',
        plotId: 'plot-1',
        dataId: 'tbl-1',
      }),
      plots,
      tables,
    )
    assert.equal(result.consoleText, 'hello')
    assert.equal(result.plot?.id, 'plot-1')
    assert.equal(result.table?.id, 'tbl-1')
    assert.deepEqual(result.kinds, ['console', 'plot', 'data'])
  })

  it('keeps prior console when plot/data are absent', () => {
    const result = resolveHistoryArtifacts(
      entry({ id: 'h2', cellId: 'c1', outputText: 'only text' }),
      plots,
      tables,
    )
    assert.equal(result.consoleText, 'only text')
    assert.equal(result.plot, null)
    assert.equal(result.table, null)
    assert.deepEqual(result.kinds, ['console'])
  })

  it('ignores plot/data ids that belong to another cell', () => {
    const result = resolveHistoryArtifacts(
      entry({
        id: 'h3',
        cellId: 'c1',
        outputText: 'x',
        plotId: 'plot-2',
        dataId: 'missing',
      }),
      plots,
      tables,
    )
    assert.equal(result.plot, null)
    assert.equal(result.table, null)
    assert.deepEqual(result.kinds, ['console'])
  })

  it('treats empty outputText as no console artifact', () => {
    const result = resolveHistoryArtifacts(
      entry({ id: 'h4', cellId: 'c1', outputText: '', plotId: 'plot-1' }),
      plots,
      tables,
    )
    assert.equal(result.consoleText, null)
    assert.equal(result.plot?.id, 'plot-1')
    assert.deepEqual(result.kinds, ['plot'])
  })
})

describe('historyArtifactLabel', () => {
  it('labels each kind', () => {
    assert.equal(historyArtifactLabel('console'), 'Console')
    assert.equal(historyArtifactLabel('plot'), 'Plot')
    assert.equal(historyArtifactLabel('data'), 'Data')
  })
})
