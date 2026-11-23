import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSameHistoryCode,
  mergeHistoryAfterRun,
  mergePanelAfterRun,
  packageRunOutputs,
} from './runArtifacts.ts'
import type { ConsoleEntry, DataTable, HistoryEntry, PlotSpec } from '../types.ts'
import type { RunArtifacts } from './runtime.ts'

function baseResult(overrides: Partial<RunArtifacts> = {}): RunArtifacts {
  return {
    logs: ['ok'],
    plot: null,
    table: null,
    env: [],
    ...overrides,
  }
}

function entry(partial: Partial<HistoryEntry> & Pick<HistoryEntry, 'id' | 'code'>): HistoryEntry {
  return {
    cellId: 'cell_1',
    cellName: 'Cell 1',
    previousCode: '',
    timestamp: 1_000,
    status: 'ok',
    ...partial,
  }
}

function table(partial: Partial<DataTable> & Pick<DataTable, 'id'>): DataTable {
  return {
    cellId: 'cell_1',
    name: 'df',
    columns: ['a'],
    rows: [{ a: 1 }],
    createdAt: 1_000,
    sourceCode: 'df <- data.frame(a = 1)',
    ...partial,
  }
}

function plot(partial: Partial<PlotSpec> & Pick<PlotSpec, 'id'>): PlotSpec {
  return {
    cellId: 'cell_1',
    title: 'plot',
    kind: 'bar',
    labels: ['a'],
    values: [1],
    createdAt: 1_000,
    sourceCode: 'barplot(1)',
    ...partial,
  }
}

function logEntry(partial: Partial<ConsoleEntry> & Pick<ConsoleEntry, 'id'>): ConsoleEntry {
  return {
    cellId: 'cell_1',
    text: 'ok',
    timestamp: 1_000,
    status: 'ok',
    sourceCode: 'print(1)',
    ...partial,
  }
}

describe('isSameHistoryCode', () => {
  it('uses exact string equality (whitespace-sensitive)', () => {
    assert.equal(isSameHistoryCode('x <- 1', 'x <- 1'), true)
    assert.equal(isSameHistoryCode('x <- 1', 'x <- 1 '), false)
    assert.equal(isSameHistoryCode('x <- 1', 'x<-1'), false)
  })
})

describe('packageRunOutputs history dedupe', () => {
  it('creates a new History entry on first run', () => {
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code: 'x <- 1:3',
      previousEntry: null,
      result: baseResult(),
    })
    assert.equal(packaged.historyReused, false)
    assert.equal(packaged.historyEntry.code, 'x <- 1:3')
    assert.ok(packaged.historyEntry.id.startsWith('hist_'))
  })

  it('reuses the latest entry and bumps timestamp when code is unchanged', async () => {
    const prior = entry({
      id: 'hist_keep',
      code: 'x <- 1:3',
      timestamp: 1_000,
      consoleId: 'console_old',
    })
    const priorConsole = logEntry({
      id: 'console_old',
      sourceCode: 'x <- 1:3',
      timestamp: 1_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code: 'x <- 1:3',
      previousEntry: prior,
      previousConsole: priorConsole,
      result: baseResult({ logs: ['rerun'] }),
    })
    assert.equal(packaged.historyReused, true)
    assert.equal(packaged.consoleReused, true)
    assert.equal(packaged.historyEntry.id, 'hist_keep')
    assert.equal(packaged.historyEntry.code, 'x <- 1:3')
    assert.ok(packaged.historyEntry.timestamp > prior.timestamp)
    assert.equal(packaged.historyEntry.outputText, 'rerun')
    assert.equal(packaged.consoleEntry.id, 'console_old')
    assert.ok(packaged.consoleEntry.timestamp > priorConsole.timestamp)
    assert.equal(packaged.consoleEntry.historyId, 'hist_keep')
  })

  it('does not create a History or Data entry when only Data output changes', async () => {
    const code = 'df <- data.frame(a = 1:2)'
    const prior = entry({
      id: 'hist_keep',
      code,
      timestamp: 1_000,
      dataId: 'data_keep',
    })
    const priorTable = table({
      id: 'data_keep',
      sourceCode: code,
      createdAt: 1_000,
      rows: [{ a: 1 }],
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code,
      previousEntry: prior,
      previousTable: priorTable,
      result: baseResult({
        logs: [],
        table: {
          id: 'data_new',
          cellId: 'cell_1',
          name: 'df',
          columns: ['a'],
          rows: [{ a: 1 }, { a: 2 }],
          createdAt: 2_000,
        },
      }),
    })
    assert.equal(packaged.historyReused, true)
    assert.equal(packaged.tableReused, true)
    assert.equal(packaged.historyEntry.id, 'hist_keep')
    assert.equal(packaged.table?.id, 'data_keep')
    assert.equal(packaged.table?.historyId, 'hist_keep')
    assert.equal(packaged.historyEntry.dataId, 'data_keep')
    assert.deepEqual(packaged.table?.rows, [{ a: 1 }, { a: 2 }])
    assert.ok((packaged.table?.createdAt ?? 0) > priorTable.createdAt)
  })

  it('reuses Plot panel entry when source is unchanged', async () => {
    const code = 'barplot(1:3)'
    const priorPlot = plot({
      id: 'plot_keep',
      sourceCode: code,
      createdAt: 1_000,
      values: [1, 2, 3],
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code,
      previousEntry: entry({ id: 'hist_keep', code }),
      previousPlot: priorPlot,
      result: baseResult({
        plot: {
          id: 'plot_new',
          cellId: 'cell_1',
          title: 'plot',
          kind: 'bar',
          labels: ['a', 'b', 'c'],
          values: [1, 2, 3],
          createdAt: 2_000,
        },
      }),
    })
    assert.equal(packaged.plotReused, true)
    assert.equal(packaged.plot?.id, 'plot_keep')
    assert.ok((packaged.plot?.createdAt ?? 0) > priorPlot.createdAt)
  })

  it('appends a new History entry when source differs', () => {
    const prior = entry({ id: 'hist_old', code: 'x <- 1' })
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code: 'x <- 2',
      previousEntry: prior,
      result: baseResult(),
    })
    assert.equal(packaged.historyReused, false)
    assert.notEqual(packaged.historyEntry.id, 'hist_old')
    assert.equal(packaged.historyEntry.previousCode, 'x <- 1')
    assert.equal(packaged.historyEntry.code, 'x <- 2')
  })

  it('appends a new Data entry when source differs', () => {
    const priorTable = table({
      id: 'data_old',
      sourceCode: 'df <- data.frame(a = 1)',
    })
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code: 'df <- data.frame(a = 1:2)',
      previousTable: priorTable,
      result: baseResult({
        table: {
          id: 'data_new',
          cellId: 'cell_1',
          name: 'df',
          columns: ['a'],
          rows: [{ a: 1 }, { a: 2 }],
          createdAt: 2_000,
        },
      }),
    })
    assert.equal(packaged.tableReused, false)
    assert.equal(packaged.table?.id, 'data_new')
  })

  it('treats whitespace-only edits as a new History entry', () => {
    const prior = entry({ id: 'hist_old', code: 'x <- 1' })
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code: 'x <- 1\n',
      previousEntry: prior,
      result: baseResult(),
    })
    assert.equal(packaged.historyReused, false)
    assert.notEqual(packaged.historyEntry.id, 'hist_old')
  })
})

describe('mergeHistoryAfterRun / mergePanelAfterRun', () => {
  it('appends when not reused', () => {
    const prior = entry({ id: 'hist_a', code: 'a' })
    const next = entry({ id: 'hist_b', code: 'b', timestamp: 2_000 })
    const merged = mergeHistoryAfterRun([prior], next, false)
    assert.equal(merged.length, 2)
    assert.equal(merged[1].id, 'hist_b')
  })

  it('updates History in place when reused (same-code re-run)', () => {
    const a = entry({ id: 'hist_a', code: 'a', timestamp: 1_000 })
    const b = entry({ id: 'hist_b', code: 'b', cellId: 'cell_2', timestamp: 2_000 })
    const updated = entry({ id: 'hist_a', code: 'a', timestamp: 3_000, outputText: 'again' })
    const merged = mergeHistoryAfterRun([a, b], updated, true)
    assert.equal(merged.length, 2)
    assert.equal(merged[0].timestamp, 3_000)
    assert.equal(merged[0].outputText, 'again')
    assert.equal(merged[1].id, 'hist_b')
  })

  it('updates Data panel series in place when reused', () => {
    const a = table({ id: 'data_a', createdAt: 1_000 })
    const b = table({ id: 'data_b', cellId: 'cell_2', createdAt: 2_000 })
    const updated = table({
      id: 'data_a',
      createdAt: 3_000,
      rows: [{ a: 9 }],
    })
    const merged = mergePanelAfterRun([a, b], updated, true)
    assert.equal(merged.length, 2)
    assert.equal(merged[0].createdAt, 3_000)
    assert.deepEqual(merged[0].rows, [{ a: 9 }])
    assert.equal(merged[1].id, 'data_b')
  })

  it('leaves series unchanged when next is null', () => {
    const a = table({ id: 'data_a' })
    assert.equal(mergePanelAfterRun([a], null, false).length, 1)
  })
})
