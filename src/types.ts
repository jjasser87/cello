export type PanelId =
  | 'cells'
  | 'history'
  | 'plot'
  | 'files'
  | 'env'
  | 'data'
  | 'structure'
  | 'ai'
  | 'console'

export type CellStatus = 'idle' | 'running' | 'ok' | 'error'

export interface Cell {
  id: string
  name: string
  code: string
  status: CellStatus
  error?: string
  lastRunAt?: number
}

export interface HistoryEntry {
  id: string
  cellId: string
  cellName: string
  code: string
  previousCode: string
  timestamp: number
  status: 'ok' | 'error'
  error?: string
  outputText?: string
  plotId?: string
  dataId?: string
}

export interface PlotSpec {
  id: string
  cellId: string
  title: string
  kind: 'bar' | 'line'
  labels: string[]
  values: number[]
  createdAt: number
}

export interface DataTable {
  id: string
  cellId: string
  name: string
  columns: string[]
  rows: Record<string, string | number | boolean | null>[]
  createdAt: number
}

export interface EnvBinding {
  name: string
  kind: 'number' | 'string' | 'boolean' | 'array' | 'object' | 'function' | 'null' | 'undefined'
  preview: string
}

export interface ProjectFile {
  id: string
  name: string
  kind: 'file' | 'folder'
  children?: ProjectFile[]
}

export interface WorkspaceState {
  cells: Cell[]
  activeCellId: string
  activePanel: PanelId
  sidePanelOpen: boolean
  history: HistoryEntry[]
  historyIndex: number
  plots: PlotSpec[]
  activePlotId: string | null
  tables: DataTable[]
  activeTableId: string | null
  env: EnvBinding[]
  consoleLines: string[]
  files: ProjectFile[]
  scriptPath: string
}
