import { createId } from './script.ts'
import type { ConsoleEntry, DataTable, HistoryEntry, PlotSpec } from '../types.ts'
import type { RunArtifacts } from './runtime.ts'

/**
 * Compare rule for History / panel-history dedupe: exact string equality of
 * cell source. Whitespace / formatting differences count as a new entry.
 * (Chosen over normalize-and-trim so intentional whitespace edits are kept.)
 */
export function isSameHistoryCode(a: string, b: string): boolean {
  return a === b
}

/** Latest series item for a cell (newest last). */
export function latestPanelItemForCell<T extends { cellId: string }>(
  items: T[],
  cellId: string,
): T | undefined {
  return [...items].reverse().find((item) => item.cellId === cellId)
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

/** Replace a Plot / Data / Console row in place, or append when source changed. */
export function mergePanelAfterRun<T extends { id: string }>(
  items: T[],
  next: T | null | undefined,
  reused: boolean,
): T[] {
  if (!next) return items
  if (!reused) return [...items, next]
  return items.map((item) => (item.id === next.id ? next : item))
}

/** Stamp source code + history link onto plot/table and build a console entry. */
export function packageRunOutputs(args: {
  cellId: string
  cellName: string
  code: string
  /** Latest History entry for this cell, if any (used for dedupe + previousCode). */
  previousEntry?: HistoryEntry | null
  /** Latest Plot / Data / Console for this cell — reused when source matches. */
  previousPlot?: PlotSpec | null
  previousTable?: DataTable | null
  previousConsole?: ConsoleEntry | null
  /** @deprecated Prefer previousEntry; kept for call-site compatibility. */
  previousCode?: string
  result: RunArtifacts
}): {
  historyEntry: HistoryEntry
  /** True when code matched the latest History entry — timestamp bumped, no new row. */
  historyReused: boolean
  plot: PlotSpec | null
  plotReused: boolean
  table: DataTable | null
  tableReused: boolean
  consoleEntry: ConsoleEntry
  consoleReused: boolean
} {
  const { cellId, cellName, code, result } = args
  const previousEntry = args.previousEntry ?? null
  const previousPlot = args.previousPlot ?? null
  const previousTable = args.previousTable ?? null
  const previousConsole = args.previousConsole ?? null
  const previousCode = previousEntry?.code ?? args.previousCode ?? ''
  const historyReused =
    previousEntry != null && isSameHistoryCode(previousEntry.code, code)

  const historyId = historyReused ? previousEntry.id : createId('hist')
  const timestamp = Date.now()
  const status = result.error ? ('error' as const) : ('ok' as const)

  const plotReused =
    result.plot != null &&
    previousPlot != null &&
    isSameHistoryCode(previousPlot.sourceCode ?? '', code)
  const plot = result.plot
    ? {
        ...result.plot,
        id: plotReused ? previousPlot.id : result.plot.id,
        createdAt: timestamp,
        sourceCode: code,
        historyId,
      }
    : null

  const tableReused =
    result.table != null &&
    previousTable != null &&
    isSameHistoryCode(previousTable.sourceCode ?? '', code)
  const table = result.table
    ? {
        ...result.table,
        id: tableReused ? previousTable.id : result.table.id,
        createdAt: timestamp,
        sourceCode: code,
        historyId,
      }
    : null

  const text = result.logs.length
    ? result.logs.join('\n')
    : result.error
      ? `Error: ${result.error}`
      : '(no output)'

  const consoleReused =
    previousConsole != null && isSameHistoryCode(previousConsole.sourceCode, code)
  const consoleId = consoleReused ? previousConsole.id : createId('console')

  const consoleEntry: ConsoleEntry = {
    id: consoleId,
    cellId,
    text,
    timestamp,
    status,
    sourceCode: code,
    historyId,
  }

  const historyEntry: HistoryEntry = historyReused
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

  return {
    historyEntry,
    historyReused,
    plot,
    plotReused,
    table,
    tableReused,
    consoleEntry,
    consoleReused,
  }
}
