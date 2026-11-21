import type { Cell, ConsoleEntry, DataTable, HistoryEntry, PlotSpec } from '../types'

/** Put the cell editor back to the source that produced a historical run. */
export function restoreCellCode(cells: Cell[], cellId: string, sourceCode: string): Cell[] {
  return cells.map((cell) =>
    cell.id === cellId
      ? { ...cell, code: sourceCode, status: 'idle' as const, error: undefined }
      : cell,
  )
}

export function sourceCodeForPlot(
  plot: PlotSpec,
  history: HistoryEntry[],
): string | null {
  if (plot.sourceCode != null) return plot.sourceCode
  if (plot.historyId) {
    const entry = history.find((item) => item.id === plot.historyId)
    if (entry) return entry.code
  }
  const linked = history.find((item) => item.plotId === plot.id)
  return linked?.code ?? null
}

export function sourceCodeForTable(
  table: DataTable,
  history: HistoryEntry[],
): string | null {
  if (table.sourceCode != null) return table.sourceCode
  if (table.historyId) {
    const entry = history.find((item) => item.id === table.historyId)
    if (entry) return entry.code
  }
  const linked = history.find((item) => item.dataId === table.id)
  return linked?.code ?? null
}

export function sourceCodeForConsole(
  entry: ConsoleEntry,
  history: HistoryEntry[],
): string | null {
  if (entry.sourceCode != null) return entry.sourceCode
  if (entry.historyId) {
    const hist = history.find((item) => item.id === entry.historyId)
    if (hist) return hist.code
  }
  return null
}
