/**
 * Structure B sidecar under `.cello/`:
 * - history.json — code history (always on Save)
 * - ui.json — active cell/panel + project UI prefs
 * - runs/artifacts.json — plots / console / data priors (when saveOutputs)
 */
import type {
  ConsoleEntry,
  DataTable,
  HelperDock,
  HistoryEntry,
  PanelId,
  PlotSpec,
  WorkspaceState,
} from '../types.ts'
import { SIDECAR_DIR } from './folderProject.ts'

export const HISTORY_FILE = 'history.json'
export const UI_FILE = 'ui.json'
export const RUNS_DIR = 'runs'
export const ARTIFACTS_FILE = 'artifacts.json'

export type SidecarUi = {
  version: 1
  activeCellId?: string
  activePanel?: PanelId
  helperDock?: HelperDock
  saveOutputs?: boolean
  hideSidecar?: boolean
}

export type SidecarHistoryDoc = {
  version: 1
  entries: HistoryEntry[]
}

export type SidecarArtifactsDoc = {
  version: 1
  plots: PlotSpec[]
  tables: DataTable[]
  consoleEntries: ConsoleEntry[]
  activePlotId: string | null
  activeTableId: string | null
  activeConsoleId: string | null
}

export type LoadedSidecar = {
  history: HistoryEntry[]
  historyIndex: number
  plots: PlotSpec[]
  tables: DataTable[]
  consoleEntries: ConsoleEntry[]
  activePlotId: string | null
  activeTableId: string | null
  activeConsoleId: string | null
  ui: SidecarUi
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sidecarRel(...parts: string[]): string {
  return [SIDECAR_DIR, ...parts].join('/')
}

export function buildSidecarUi(state: WorkspaceState): SidecarUi {
  return {
    version: 1,
    activeCellId: state.activeCellId,
    activePanel: state.activePanel,
    helperDock: state.helperDock,
    saveOutputs: state.saveOutputs,
    hideSidecar: state.hideSidecar,
  }
}

export function buildSidecarHistory(state: WorkspaceState): SidecarHistoryDoc {
  return {
    version: 1,
    entries: state.history.map((entry) => ({ ...entry })),
  }
}

export function buildSidecarArtifacts(state: WorkspaceState): SidecarArtifactsDoc {
  return {
    version: 1,
    plots: state.plots.map((plot) => ({ ...plot })),
    tables: state.tables.map((table) => ({ ...table })),
    consoleEntries: state.consoleEntries.map((entry) => ({ ...entry })),
    activePlotId: state.activePlotId,
    activeTableId: state.activeTableId,
    activeConsoleId: state.activeConsoleId,
  }
}

export function stringifySidecarDoc(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

export function parseSidecarUi(raw: unknown): SidecarUi {
  if (!isRecord(raw)) return { version: 1 }
  return {
    version: 1,
    activeCellId: typeof raw.activeCellId === 'string' ? raw.activeCellId : undefined,
    activePanel: typeof raw.activePanel === 'string' ? (raw.activePanel as PanelId) : undefined,
    helperDock:
      raw.helperDock === 'left' ||
      raw.helperDock === 'right' ||
      raw.helperDock === 'top' ||
      raw.helperDock === 'bottom'
        ? raw.helperDock
        : undefined,
    saveOutputs: typeof raw.saveOutputs === 'boolean' ? raw.saveOutputs : undefined,
    hideSidecar: typeof raw.hideSidecar === 'boolean' ? raw.hideSidecar : undefined,
  }
}

export function parseSidecarHistory(raw: unknown): HistoryEntry[] {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) return []
  const out: HistoryEntry[] = []
  for (const item of raw.entries) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || typeof item.cellId !== 'string') continue
    if (typeof item.code !== 'string' || typeof item.timestamp !== 'number') continue
    out.push({
      id: item.id,
      cellId: item.cellId,
      cellName: typeof item.cellName === 'string' ? item.cellName : 'Untitled',
      code: item.code,
      previousCode: typeof item.previousCode === 'string' ? item.previousCode : '',
      timestamp: item.timestamp,
      status: item.status === 'error' ? 'error' : 'ok',
      error: typeof item.error === 'string' ? item.error : undefined,
      outputText: typeof item.outputText === 'string' ? item.outputText : undefined,
      plotId: typeof item.plotId === 'string' ? item.plotId : undefined,
      dataId: typeof item.dataId === 'string' ? item.dataId : undefined,
      consoleId: typeof item.consoleId === 'string' ? item.consoleId : undefined,
    })
  }
  return out
}

function parsePlot(raw: unknown): PlotSpec | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.cellId !== 'string') return null
  if (typeof raw.title !== 'string' || typeof raw.createdAt !== 'number') return null
  const kind = raw.kind === 'line' || raw.kind === 'image' || raw.kind === 'bar' ? raw.kind : 'bar'
  return {
    id: raw.id,
    cellId: raw.cellId,
    title: raw.title,
    kind,
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
    values: Array.isArray(raw.values)
      ? raw.values.map((v) => (typeof v === 'number' ? v : Number(v) || 0))
      : [],
    imageData: typeof raw.imageData === 'string' ? raw.imageData : undefined,
    createdAt: raw.createdAt,
    sourceCode: typeof raw.sourceCode === 'string' ? raw.sourceCode : undefined,
    historyId: typeof raw.historyId === 'string' ? raw.historyId : undefined,
  }
}

function parseTable(raw: unknown): DataTable | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.cellId !== 'string') return null
  if (typeof raw.name !== 'string' || typeof raw.createdAt !== 'number') return null
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null
  return {
    id: raw.id,
    cellId: raw.cellId,
    name: raw.name,
    columns: raw.columns.map(String),
    rows: raw.rows.filter(isRecord) as DataTable['rows'],
    createdAt: raw.createdAt,
    sourceCode: typeof raw.sourceCode === 'string' ? raw.sourceCode : undefined,
    historyId: typeof raw.historyId === 'string' ? raw.historyId : undefined,
  }
}

function parseConsoleEntry(raw: unknown): ConsoleEntry | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.cellId !== 'string') return null
  if (typeof raw.text !== 'string' || typeof raw.timestamp !== 'number') return null
  return {
    id: raw.id,
    cellId: raw.cellId,
    text: raw.text,
    timestamp: raw.timestamp,
    status: raw.status === 'error' ? 'error' : 'ok',
    sourceCode: typeof raw.sourceCode === 'string' ? raw.sourceCode : '',
    historyId: typeof raw.historyId === 'string' ? raw.historyId : undefined,
  }
}

export function parseSidecarArtifacts(raw: unknown): Omit<
  SidecarArtifactsDoc,
  'version'
> {
  if (!isRecord(raw)) {
    return {
      plots: [],
      tables: [],
      consoleEntries: [],
      activePlotId: null,
      activeTableId: null,
      activeConsoleId: null,
    }
  }
  const plots = Array.isArray(raw.plots)
    ? raw.plots.map(parsePlot).filter((p): p is PlotSpec => p !== null)
    : []
  const tables = Array.isArray(raw.tables)
    ? raw.tables.map(parseTable).filter((t): t is DataTable => t !== null)
    : []
  const consoleEntries = Array.isArray(raw.consoleEntries)
    ? raw.consoleEntries
        .map(parseConsoleEntry)
        .filter((e): e is ConsoleEntry => e !== null)
    : []
  return {
    plots,
    tables,
    consoleEntries,
    activePlotId: typeof raw.activePlotId === 'string' ? raw.activePlotId : null,
    activeTableId: typeof raw.activeTableId === 'string' ? raw.activeTableId : null,
    activeConsoleId: typeof raw.activeConsoleId === 'string' ? raw.activeConsoleId : null,
  }
}

export type SidecarWritePlan = {
  /** Relative paths under the project root → file contents. */
  files: { relativePath: string; contents: string }[]
}

/** Build every sidecar file that Save should write for structure B. */
export function planSidecarWrites(state: WorkspaceState): SidecarWritePlan {
  const files: SidecarWritePlan['files'] = [
    {
      relativePath: sidecarRel(HISTORY_FILE),
      contents: stringifySidecarDoc(buildSidecarHistory(state)),
    },
    {
      relativePath: sidecarRel(UI_FILE),
      contents: stringifySidecarDoc(buildSidecarUi(state)),
    },
  ]
  if (state.saveOutputs) {
    files.push({
      relativePath: sidecarRel(RUNS_DIR, ARTIFACTS_FILE),
      contents: stringifySidecarDoc(buildSidecarArtifacts(state)),
    })
  }
  return { files }
}

export function emptyLoadedSidecar(): LoadedSidecar {
  return {
    history: [],
    historyIndex: -1,
    plots: [],
    tables: [],
    consoleEntries: [],
    activePlotId: null,
    activeTableId: null,
    activeConsoleId: null,
    ui: { version: 1 },
  }
}

export function mergeParsedSidecar(args: {
  historyText?: string | null
  uiText?: string | null
  artifactsText?: string | null
}): LoadedSidecar {
  const base = emptyLoadedSidecar()
  if (args.historyText) {
    try {
      const entries = parseSidecarHistory(JSON.parse(args.historyText) as unknown)
      base.history = entries
      base.historyIndex = entries.length > 0 ? entries.length - 1 : -1
    } catch {
      /* ignore corrupt history */
    }
  }
  if (args.uiText) {
    try {
      base.ui = parseSidecarUi(JSON.parse(args.uiText) as unknown)
    } catch {
      /* ignore */
    }
  }
  if (args.artifactsText) {
    try {
      const arts = parseSidecarArtifacts(JSON.parse(args.artifactsText) as unknown)
      base.plots = arts.plots
      base.tables = arts.tables
      base.consoleEntries = arts.consoleEntries
      base.activePlotId = arts.activePlotId
      base.activeTableId = arts.activeTableId
      base.activeConsoleId = arts.activeConsoleId
    } catch {
      /* ignore */
    }
  }
  return base
}

/** Join project root + sidecar-relative path (posix or Windows separators). */
export function sidecarAbsolute(root: string, ...parts: string[]): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const base = root.replace(/[/\\]+$/, '')
  const rel = sidecarRel(...parts).replace(/^[/\\]+/, '').replace(/\//g, sep)
  return `${base}${sep}${rel}`
}
