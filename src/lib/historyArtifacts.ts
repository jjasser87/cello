import type { DataTable, HistoryEntry, PlotSpec } from '../types'

/** Artifact kinds a history run may retain for later revisit. */
export type HistoryArtifactKind = 'console' | 'plot' | 'data'

export interface HistoryArtifacts {
  consoleText: string | null
  plot: PlotSpec | null
  table: DataTable | null
  kinds: HistoryArtifactKind[]
}

/**
 * Resolve console / plot / data retained for a history entry.
 * Scoped to the entry's cell via plotId / dataId links stored at run time.
 */
export function resolveHistoryArtifacts(
  entry: HistoryEntry,
  plots: PlotSpec[],
  tables: DataTable[],
): HistoryArtifacts {
  const consoleText =
    entry.outputText != null && entry.outputText.length > 0 ? entry.outputText : null
  const plot = entry.plotId
    ? plots.find((item) => item.id === entry.plotId && item.cellId === entry.cellId) ?? null
    : null
  const table = entry.dataId
    ? tables.find((item) => item.id === entry.dataId && item.cellId === entry.cellId) ?? null
    : null

  const kinds: HistoryArtifactKind[] = []
  if (consoleText) kinds.push('console')
  if (plot) kinds.push('plot')
  if (table) kinds.push('data')

  return { consoleText, plot, table, kinds }
}

export function historyArtifactLabel(kind: HistoryArtifactKind): string {
  switch (kind) {
    case 'console':
      return 'Console'
    case 'plot':
      return 'Plot'
    case 'data':
      return 'Data'
  }
}
