import { createId } from './script.ts'
import type { ConsoleEntry, DataTable, HistoryEntry, PlotSpec } from '../types.ts'
import type { RunArtifacts } from './runtime.ts'

/**
 * Compare rule for History dedupe: exact string equality of cell source.
 * Whitespace / formatting differences count as a new History entry.
 * (Chosen over normalize-and-trim so intentional whitespace edits are kept.)
 */
export function isSameHistoryCode(a: string, b: string): boolean {
  return a === b
}

/** Replace an existing History row in place, or append when the code changed. */
export function mergeHistoryAfterRun(
  history: HistoryEntry[],
  entry: HistoryEntry,
  reused: boolean,
): HistoryEntry[] {
  if (!reused) return [...history, entry]
  return history.map((item) => (item.id === entry.id ? entry : item))
}

/** Stamp source code + history link onto plot/table and build a console entry. */
export function packageRunOutputs(args: {
  cellId: string
  cellName: string
  code: string
  /** Latest History entry for this cell, if any (used for dedupe + previousCode). */
  previousEntry?: HistoryEntry | null
  /** @deprecated Prefer previousEntry; kept for call-site compatibility. */
  previousCode?: string
  result: RunArtifacts
}): {
  historyEntry: HistoryEntry
  /** True when code matched the latest entry — timestamp bumped, no new row. */
  historyReused: boolean
  plot: PlotSpec | null
  table: DataTable | null
  consoleEntry: ConsoleEntry
} {
  const { cellId, cellName, code, result } = args
  const previousEntry = args.previousEntry ?? null
  const previousCode = previousEntry?.code ?? args.previousCode ?? ''
  const reuse =
    previousEntry != null && isSameHistoryCode(previousEntry.code, code)

  const historyId = reuse ? previousEntry.id : createId('hist')
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

  const historyEntry: HistoryEntry = reuse
    ? {
        ...previousEntry,
        cellName,
        timestamp,
        status,
        error: result.error,
        outputText: text,
        plotId: plot?.id ?? previousEntry.plotId,
        dataId: table?.id ?? previousEntry.dataId,
        consoleId,
      }
    : {
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

  return { historyEntry, historyReused: reuse, plot, table, consoleEntry }
}
