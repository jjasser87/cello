import { createId } from './script'
import type { ConsoleEntry, DataTable, HistoryEntry, PlotSpec } from '../types'
import type { RunArtifacts } from './runtime'

/** Stamp source code + history link onto plot/table and build a console entry. */
export function packageRunOutputs(args: {
  cellId: string
  cellName: string
  code: string
  previousCode: string
  result: RunArtifacts
}): {
  historyEntry: HistoryEntry
  plot: PlotSpec | null
  table: DataTable | null
  consoleEntry: ConsoleEntry
} {
  const { cellId, cellName, code, previousCode, result } = args
  const historyId = createId('hist')
  const consoleId = createId('console')
  const timestamp = Date.now()
  const status = result.error ? ('error' as const) : ('ok' as const)

  const plot = result.plot
    ? {
        ...result.plot,
        sourceCode: code,
        historyId,
      }
    : null
  const table = result.table
    ? {
        ...result.table,
        sourceCode: code,
        historyId,
      }
    : null

  const text = result.logs.length
    ? result.logs.join('\n')
    : result.error
      ? `Error: ${result.error}`
      : '(no output)'

  const consoleEntry: ConsoleEntry = {
    id: consoleId,
    cellId,
    text,
    timestamp,
    status,
    sourceCode: code,
    historyId,
  }

  const historyEntry: HistoryEntry = {
    id: historyId,
    cellId,
    cellName,
    code,
    previousCode,
    timestamp,
    status,
    error: result.error,
    outputText: text,
    plotId: plot?.id,
    dataId: table?.id,
    consoleId,
  }

  return { historyEntry, plot, table, consoleEntry }
}
