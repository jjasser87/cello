import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSameHistoryCode,
  mergeHistoryAfterRun,
  packageRunOutputs,
} from './runArtifacts.ts'
import type { HistoryEntry } from '../types.ts'
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
    // Ensure Date.now advances past the prior stamp.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code: 'x <- 1:3',
      previousEntry: prior,
      result: baseResult({ logs: ['rerun'] }),
    })
    assert.equal(packaged.historyReused, true)
    assert.equal(packaged.historyEntry.id, 'hist_keep')
    assert.equal(packaged.historyEntry.code, 'x <- 1:3')
    assert.ok(packaged.historyEntry.timestamp > prior.timestamp)
    assert.equal(packaged.historyEntry.outputText, 'rerun')
    assert.notEqual(packaged.consoleEntry.id, 'console_old')
    assert.equal(packaged.consoleEntry.historyId, 'hist_keep')
  })

  it('does not create a History entry when only Data output changes', () => {
    const prior = entry({
      id: 'hist_keep',
      code: 'df <- data.frame(a = 1:2)',
      timestamp: 1_000,
      dataId: 'data_old',
    })
    const packaged = packageRunOutputs({
      cellId: 'cell_1',
      cellName: 'Cell 1',
      code: 'df <- data.frame(a = 1:2)',
      previousEntry: prior,
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
    assert.equal(packaged.historyEntry.id, 'hist_keep')
    assert.equal(packaged.table?.id, 'data_new')
    assert.equal(packaged.table?.historyId, 'hist_keep')
    assert.equal(packaged.historyEntry.dataId, 'data_new')
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

describe('mergeHistoryAfterRun', () => {
  it('appends when not reused', () => {
    const prior = entry({ id: 'hist_a', code: 'a' })
    const next = entry({ id: 'hist_b', code: 'b', timestamp: 2_000 })
    const merged = mergeHistoryAfterRun([prior], next, false)
    assert.equal(merged.length, 2)
    assert.equal(merged[1].id, 'hist_b')
  })

  it('updates in place when reused (same-code re-run)', () => {
    const a = entry({ id: 'hist_a', code: 'a', timestamp: 1_000 })
    const b = entry({ id: 'hist_b', code: 'b', cellId: 'cell_2', timestamp: 2_000 })
    const updated = entry({ id: 'hist_a', code: 'a', timestamp: 3_000, outputText: 'again' })
    const merged = mergeHistoryAfterRun([a, b], updated, true)
    assert.equal(merged.length, 2)
    assert.equal(merged[0].timestamp, 3_000)
    assert.equal(merged[0].outputText, 'again')
    assert.equal(merged[1].id, 'hist_b')
  })
})
