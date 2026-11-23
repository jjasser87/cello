import type { Cell, ConsoleEntry, DataTable, HistoryEntry, PlotSpec } from '../types'

/** Put the cell editor back to the source that produced a historical run. */
export function restoreCellCode(cells: Cell[], cellId: string, sourceCode: string): Cell[] {
  return cells.map((cell) =>
    cell.id === cellId
      ? { ...cell, code: sourceCode, status: 'idle' as const, error: undefined }
      : cell,
  )
}

/**
 * Keep this cell's series through `keepId` (inclusive, in array order) and drop
 * every newer entry for that cell. Entries for other cells are unchanged.
 */
export function truncateCellSeries<T extends { id: string; cellId: string }>(
  items: T[],
  cellId: string,
  keepId: string,
): T[] {
  const cellItems = items.filter((item) => item.cellId === cellId)
  const keepIndex = cellItems.findIndex((item) => item.id === keepId)
  if (keepIndex < 0) return items
  const keepIds = new Set(cellItems.slice(0, keepIndex + 1).map((item) => item.id))
  return items.filter((item) => item.cellId !== cellId || keepIds.has(item.id))
}

/** Drop plot / table / console priors for a cell whose historyId was discarded. */
export function dropArtifactsForDiscardedHistory<
  T extends { cellId: string; historyId?: string; id: string },
>(items: T[], cellId: string, keptHistoryIds: Set<string>): T[] {
  return items.filter((item) => {
    if (item.cellId !== cellId) return true
    if (item.historyId) return keptHistoryIds.has(item.historyId)
    return true
  })
}

export type CodeHistoryRevertResult = {
  cells: Cell[]
  history: HistoryEntry[]
  historyIndex: number
  plots: PlotSpec[]
  tables: DataTable[]
  consoleEntries: ConsoleEntry[]
  activePlotId: string | null
  activeTableId: string | null
  activeConsoleId: string | null
  activeCellId: string
}

/**
 * Restore cell code to a history entry and truncate forward: drop newer code
 * history for that cell, plus linked plot/console/data priors for discarded runs.
 */
export function applyCodeHistoryRevert(
  state: {
    cells: Cell[]
    history: HistoryEntry[]
    plots: PlotSpec[]
    tables: DataTable[]
    consoleEntries: ConsoleEntry[]
    activePlotId: string | null
    activeTableId: string | null
    activeConsoleId: string | null
  },
  entryId: string,
): CodeHistoryRevertResult | null {
  const entry = state.history.find((item) => item.id === entryId)
  if (!entry) return null
  if (!state.cells.some((cell) => cell.id === entry.cellId)) return null

  const history = truncateCellSeries(state.history, entry.cellId, entryId)
  const keptHistoryIds = new Set(
    history.filter((item) => item.cellId === entry.cellId).map((item) => item.id),
  )
  const plots = dropArtifactsForDiscardedHistory(state.plots, entry.cellId, keptHistoryIds)
  const tables = dropArtifactsForDiscardedHistory(state.tables, entry.cellId, keptHistoryIds)
  const consoleEntries = dropArtifactsForDiscardedHistory(
    state.consoleEntries,
    entry.cellId,
    keptHistoryIds,
  )
  const historyIndex = history.findIndex((item) => item.id === entryId)
  const keptEntry = history[historyIndex]

  return {
    cells: restoreCellCode(state.cells, entry.cellId, entry.code),
    history,
    historyIndex,
    plots,
    tables,
    consoleEntries,
    activeCellId: entry.cellId,
    activePlotId: pickActiveId(plots, entry.cellId, keptEntry?.plotId ?? null, state.activePlotId),
    activeTableId: pickActiveId(
      tables,
      entry.cellId,
      keptEntry?.dataId ?? null,
      state.activeTableId,
    ),
    activeConsoleId: pickActiveId(
      consoleEntries,
      entry.cellId,
      keptEntry?.consoleId ?? null,
      state.activeConsoleId,
    ),
  }
}

function pickActiveId<T extends { id: string; cellId: string }>(
  items: T[],
  cellId: string,
  preferredId: string | null,
  previousActive: string | null,
): string | null {
  if (preferredId && items.some((item) => item.id === preferredId)) return preferredId
  if (previousActive && items.some((item) => item.id === previousActive)) return previousActive
  const cellItems = items.filter((item) => item.cellId === cellId)
  return cellItems[cellItems.length - 1]?.id ?? null
}

/** Restore + truncate a typed prior series (plot / table / console) for one cell. */
export function applyTypedHistoryRevert<T extends { id: string; cellId: string }>(args: {
  items: T[]
  keepId: string
  cellId: string
  sourceCode: string | null
  cells: Cell[]
  history: HistoryEntry[]
  historyId?: string
}): {
  items: T[]
  cells: Cell[]
  activeId: string
  activeCellId: string
  historyIndex: number
} | null {
  const { items, keepId, cellId, sourceCode, cells, history, historyId } = args
  if (!items.some((item) => item.id === keepId && item.cellId === cellId)) return null
  const nextItems = truncateCellSeries(items, cellId, keepId)
  const historyIndex = historyId
    ? history.findIndex((entry) => entry.id === historyId)
    : -1
  return {
    items: nextItems,
    cells: sourceCode ? restoreCellCode(cells, cellId, sourceCode) : cells,
    activeId: keepId,
    activeCellId: cellId,
    historyIndex,
  }
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
