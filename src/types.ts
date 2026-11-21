export type PanelId =
  | 'cells'
  | 'explain'
  | 'history'
  | 'plot'
  | 'files'
  | 'env'
  | 'data'
  | 'structure'
  | 'ai'
  | 'console'

export type KernelLanguage = 'r' | 'javascript'

export type CellStatus = 'idle' | 'running' | 'ok' | 'error'

/** Feedback on a cell explanation — shaped for later AI audit loops. */
export interface ExplanationComment {
  id: string
  body: string
  createdAt: number
  /** `user` from humans; reserve `ai` (or other labels) for agent replies later. */
  author: 'user' | 'ai' | (string & {})
}

export interface Cell {
  id: string
  name: string
  code: string
  status: CellStatus
  error?: string
  lastRunAt?: number
  /** Console stream for this cell only (panel shows selected cell). */
  consoleLines?: string[]
  /** Markdown purpose doc (focus auditing). Seeded with section template when empty. */
  explanation: string
  /** Comments / feedback on the explanation; persist with the workspace. */
  comments: ExplanationComment[]
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
  kind: 'bar' | 'line' | 'image'
  labels: string[]
  values: number[]
  /** data:image/png;base64,… for native R graphics (base plot / ggplot). */
  imageData?: string
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
  language: KernelLanguage
  kernelStatus: {
    available: boolean
    version: string | null
    message: string | null
  }
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
