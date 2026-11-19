import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSharedBag, runCellCode } from '../lib/runtime'
import { STARTER_SCRIPT, cellsToScript, createId, scriptToCells } from '../lib/script'
import { loadWorkspace, saveWorkspace } from '../lib/storage'
import type {
  Cell,
  HistoryEntry,
  PanelId,
  ProjectFile,
  WorkspaceState,
} from '../types'

const DEFAULT_FILES: ProjectFile[] = [
  {
    id: 'folder_root',
    name: 'project',
    kind: 'folder',
    children: [
      { id: 'file_analysis', name: 'analysis.js', kind: 'file' },
      { id: 'file_readme', name: 'README.md', kind: 'file' },
      {
        id: 'folder_data',
        name: 'data',
        kind: 'folder',
        children: [
          { id: 'file_sales', name: 'sales.csv', kind: 'file' },
          { id: 'file_notes', name: 'notes.txt', kind: 'file' },
        ],
      },
    ],
  },
]

function buildInitial(): WorkspaceState {
  const saved = loadWorkspace()
  const cells =
    saved?.cells?.length
      ? saved.cells.map((cell) => ({
          ...cell,
          status: 'idle' as const,
        }))
      : scriptToCells(STARTER_SCRIPT)

  return {
    cells,
    activeCellId: saved?.activeCellId && cells.some((c) => c.id === saved.activeCellId)
      ? saved.activeCellId
      : cells[0].id,
    activePanel: saved?.activePanel ?? 'cells',
    sidePanelOpen: false,
    history: [],
    historyIndex: -1,
    plots: [],
    activePlotId: null,
    tables: [],
    activeTableId: null,
    env: [],
    consoleLines: ['Ready. Run a cell with ⌘/Ctrl+Enter.'],
    files: DEFAULT_FILES,
    scriptPath: saved?.scriptPath ?? 'analysis.js',
  }
}

export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>(buildInitial)
  const sharedRef = useRef(createSharedBag())

  const persistable = useMemo(
    () => ({
      cells: state.cells,
      activeCellId: state.activeCellId,
      activePanel: state.activePanel,
      sidePanelOpen: false,
      scriptPath: state.scriptPath,
      history: [] as WorkspaceState['history'],
      historyIndex: -1,
      plots: [] as WorkspaceState['plots'],
      activePlotId: null,
      tables: [] as WorkspaceState['tables'],
      activeTableId: null,
      env: [] as WorkspaceState['env'],
      consoleLines: [] as string[],
      files: state.files,
    }),
    [state.cells, state.activeCellId, state.activePanel, state.scriptPath, state.files],
  )

  const saveErrorRef = useRef<string | null>(null)

  useEffect(() => {
    const result = saveWorkspace(persistable)
    if (!result.ok) {
      // Avoid crashing the editor when storage is unavailable; keep a sticky note.
      saveErrorRef.current = result.error
      console.warn('Cello autosave failed:', result.error)
    } else {
      saveErrorRef.current = null
    }
  }, [persistable])

  const activeCell = useMemo(
    () => state.cells.find((cell) => cell.id === state.activeCellId) ?? state.cells[0],
    [state.cells, state.activeCellId],
  )

  const scriptText = useMemo(() => cellsToScript(state.cells), [state.cells])

  const setPanel = useCallback((panel: PanelId) => {
    setState((prev) => ({ ...prev, activePanel: panel, sidePanelOpen: true }))
  }, [])

  const toggleSidePanel = useCallback((panel: PanelId) => {
    setState((prev) => {
      if (prev.sidePanelOpen && prev.activePanel === panel) {
        return { ...prev, sidePanelOpen: false }
      }
      return { ...prev, activePanel: panel, sidePanelOpen: true }
    })
  }, [])

  const collapseSidePanel = useCallback(() => {
    setState((prev) => ({ ...prev, sidePanelOpen: false }))
  }, [])

  const selectCell = useCallback((cellId: string, panel?: PanelId) => {
    setState((prev) => ({
      ...prev,
      activeCellId: cellId,
      activePanel: panel ?? prev.activePanel,
      sidePanelOpen: panel ? true : prev.sidePanelOpen,
    }))
  }, [])

  const updateActiveCode = useCallback((code: string) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) =>
        cell.id === prev.activeCellId ? { ...cell, code, status: 'idle', error: undefined } : cell,
      ),
    }))
  }, [])

  const renameCell = useCallback((cellId: string, name: string) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) => (cell.id === cellId ? { ...cell, name } : cell)),
    }))
  }, [])

  const addCell = useCallback((afterId?: string) => {
    setState((prev) => {
      const cell: Cell = {
        id: createId('cell'),
        name: `Cell ${prev.cells.length + 1}`,
        code: '',
        status: 'idle',
      }
      const index = afterId
        ? prev.cells.findIndex((item) => item.id === afterId)
        : prev.cells.length - 1
      const next = [...prev.cells]
      next.splice(index + 1, 0, cell)
      return {
        ...prev,
        cells: next,
        activeCellId: cell.id,
        activePanel: 'cells',
        sidePanelOpen: true,
      }
    })
  }, [])

  const deleteCell = useCallback((cellId: string) => {
    setState((prev) => {
      const remaining = prev.cells.filter((cell) => cell.id !== cellId)
      // Deleting the last cell leaves a fresh untitled empty cell (new id).
      const cells =
        remaining.length === 0
          ? [
              {
                id: createId('cell'),
                name: 'Untitled',
                code: '',
                status: 'idle' as const,
              },
            ]
          : remaining
      const deletedIndex = prev.cells.findIndex((c) => c.id === cellId)
      const activeCellId =
        prev.activeCellId === cellId
          ? remaining.length === 0
            ? cells[0].id
            : cells[Math.max(0, deletedIndex - 1)]?.id ?? cells[0].id
          : prev.activeCellId
      const history = prev.history.filter((entry) => entry.cellId !== cellId)
      const historyIndex =
        history.length === 0
          ? -1
          : Math.min(prev.historyIndex, history.length - 1)
      return { ...prev, cells, activeCellId, history, historyIndex }
    })
  }, [])

  const moveCell = useCallback((cellId: string, direction: -1 | 1) => {
    setState((prev) => {
      const index = prev.cells.findIndex((cell) => cell.id === cellId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.cells.length) return prev
      const cells = [...prev.cells]
      const [item] = cells.splice(index, 1)
      cells.splice(target, 0, item)
      return { ...prev, cells }
    })
  }, [])

  const runCell = useCallback(
    (cellId?: string) => {
      const id = cellId ?? state.activeCellId
      const cell = state.cells.find((item) => item.id === id)
      if (!cell) return

      setState((prev) => ({
        ...prev,
        cells: prev.cells.map((item) =>
          item.id === id ? { ...item, status: 'running', error: undefined } : item,
        ),
      }))

      const previousEntry = [...state.history].reverse().find((entry) => entry.cellId === id)
      const previousCode = previousEntry?.code ?? ''
      const result = runCellCode(cell.code, sharedRef.current, { cellId: id })

      const historyEntry: HistoryEntry = {
        id: createId('hist'),
        cellId: id,
        cellName: cell.name,
        code: cell.code,
        previousCode,
        timestamp: Date.now(),
        status: result.error ? 'error' : 'ok',
        error: result.error,
        outputText: result.logs.join('\n'),
        plotId: result.plot?.id,
        dataId: result.table?.id,
      }

      setState((prev) => {
        const plots = result.plot ? [...prev.plots, result.plot] : prev.plots
        const tables = result.table ? [...prev.tables, result.table] : prev.tables
        const history = [...prev.history, historyEntry]
        let activePanel = prev.activePanel
        let sidePanelOpen = prev.sidePanelOpen
        if (result.plot) {
          activePanel = 'plot'
          sidePanelOpen = true
        } else if (result.table) {
          activePanel = 'data'
          sidePanelOpen = true
        } else if (result.error) {
          activePanel = 'history'
          sidePanelOpen = true
        }

        return {
          ...prev,
          cells: prev.cells.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: result.error ? 'error' : 'ok',
                  error: result.error,
                  lastRunAt: Date.now(),
                }
              : item,
          ),
          history,
          historyIndex: history.length - 1,
          plots,
          activePlotId: result.plot?.id ?? prev.activePlotId,
          tables,
          activeTableId: result.table?.id ?? prev.activeTableId,
          env: result.env,
          consoleLines: [
            ...prev.consoleLines,
            `▸ ${cell.name}`,
            ...(result.logs.length ? result.logs : [result.error ? `Error: ${result.error}` : '(no output)']),
          ].slice(-200),
          activePanel,
          sidePanelOpen,
        }
      })
    },
    [state.activeCellId, state.cells, state.history],
  )

  const runAll = useCallback(() => {
    // Execute once outside React updaters so StrictMode cannot double-run cells.
    const cells = state.cells
    const priorHistory = state.history
    sharedRef.current = createSharedBag()
    const shared = sharedRef.current

    type Batch = {
      cellId: string
      status: Cell['status']
      error?: string
      historyEntry: HistoryEntry
      plot?: NonNullable<ReturnType<typeof runCellCode>['plot']>
      table?: NonNullable<ReturnType<typeof runCellCode>['table']>
      env: ReturnType<typeof runCellCode>['env']
      logs: string[]
    }

    const batches: Batch[] = []
    let historyCursor = [...priorHistory]
    let stopped = false

    for (const cell of cells) {
      const previousEntry = [...historyCursor].reverse().find((entry) => entry.cellId === cell.id)
      const result = runCellCode(cell.code, shared, { cellId: cell.id })
      const historyEntry: HistoryEntry = {
        id: createId('hist'),
        cellId: cell.id,
        cellName: cell.name,
        code: cell.code,
        previousCode: previousEntry?.code ?? '',
        timestamp: Date.now(),
        status: result.error ? 'error' : 'ok',
        error: result.error,
        outputText: result.logs.join('\n'),
        plotId: result.plot?.id,
        dataId: result.table?.id,
      }
      historyCursor = [...historyCursor, historyEntry]
      batches.push({
        cellId: cell.id,
        status: result.error ? 'error' : 'ok',
        error: result.error,
        historyEntry,
        plot: result.plot ?? undefined,
        table: result.table ?? undefined,
        env: result.env,
        logs: result.logs,
      })
      if (result.error) {
        stopped = true
        break
      }
    }

    setState((prev) => {
      const history = [...prev.history, ...batches.map((batch) => batch.historyEntry)]
      const plots = [
        ...prev.plots,
        ...batches.flatMap((batch) => (batch.plot ? [batch.plot] : [])),
      ]
      const tables = [
        ...prev.tables,
        ...batches.flatMap((batch) => (batch.table ? [batch.table] : [])),
      ]
      const last = batches[batches.length - 1]
      let activePanel = prev.activePanel
      let sidePanelOpen = prev.sidePanelOpen
      if (last?.plot) {
        activePanel = 'plot'
        sidePanelOpen = true
      } else if (last?.table) {
        activePanel = 'data'
        sidePanelOpen = true
      } else if (last?.error) {
        activePanel = 'history'
        sidePanelOpen = true
      }

      const consoleLines = [
        ...prev.consoleLines,
        stopped
          ? 'Kernel reset. Running all cells in order (stopped on error)…'
          : 'Kernel reset. Running all cells in order…',
        ...batches.flatMap((batch) => {
          const cell = prev.cells.find((item) => item.id === batch.cellId)
          return [
            `▸ ${cell?.name ?? batch.cellId}`,
            ...(batch.logs.length
              ? batch.logs
              : [batch.error ? `Error: ${batch.error}` : '(no output)']),
          ]
        }),
      ].slice(-200)

      const statusById = new Map(batches.map((batch) => [batch.cellId, batch]))

      return {
        ...prev,
        env: last?.env ?? [],
        plots,
        tables,
        activePlotId: last?.plot?.id ?? prev.activePlotId,
        activeTableId: last?.table?.id ?? prev.activeTableId,
        history,
        historyIndex: history.length - 1,
        consoleLines,
        activePanel,
        sidePanelOpen,
        cells: prev.cells.map((cell) => {
          const batch = statusById.get(cell.id)
          if (!batch) {
            return { ...cell, status: 'idle', error: undefined }
          }
          return {
            ...cell,
            status: batch.status,
            error: batch.error,
            lastRunAt: Date.now(),
          }
        }),
      }
    })
  }, [state.cells, state.history])

  const resetKernel = useCallback(() => {
    sharedRef.current = createSharedBag()
    setState((prev) => ({
      ...prev,
      env: [],
      plots: [],
      tables: [],
      activePlotId: null,
      activeTableId: null,
      consoleLines: ['Kernel cleared.'],
      cells: prev.cells.map((cell) => ({ ...cell, status: 'idle', error: undefined })),
    }))
  }, [])

  const setHistoryIndex = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.history.length) return prev
      const entry = prev.history[index]
      const cellExists = prev.cells.some((cell) => cell.id === entry.cellId)
      return {
        ...prev,
        historyIndex: index,
        activeCellId: cellExists ? entry.cellId : prev.activeCellId,
        activePlotId: entry.plotId ?? prev.activePlotId,
        activeTableId: entry.dataId ?? prev.activeTableId,
      }
    })
  }, [])

  const restoreHistoryCode = useCallback(() => {
    setState((prev) => {
      const entry = prev.history[prev.historyIndex]
      if (!entry) return prev
      const cellExists = prev.cells.some((cell) => cell.id === entry.cellId)
      if (!cellExists) {
        return {
          ...prev,
          consoleLines: [
            ...prev.consoleLines,
            `warn: cannot restore — cell "${entry.cellName}" no longer exists`,
          ].slice(-200),
        }
      }
      return {
        ...prev,
        cells: prev.cells.map((cell) =>
          cell.id === entry.cellId
            ? { ...cell, code: entry.code, status: 'idle', error: undefined }
            : cell,
        ),
        activeCellId: entry.cellId,
        activePanel: 'cells',
        sidePanelOpen: true,
      }
    })
  }, [])

  const exportScript = useCallback(() => scriptText, [scriptText])

  const importScript = useCallback((text: string) => {
    sharedRef.current = createSharedBag()
    const cells = scriptToCells(text)
    setState((prev) => ({
      ...prev,
      cells,
      activeCellId: cells[0].id,
      history: [],
      historyIndex: -1,
      plots: [],
      tables: [],
      env: [],
      activePlotId: null,
      activeTableId: null,
      consoleLines: ['Imported script with # %% cell markers.'],
      activePanel: 'cells',
      sidePanelOpen: false,
    }))
  }, [])

  return {
    state,
    activeCell,
    scriptText,
    setPanel,
    toggleSidePanel,
    collapseSidePanel,
    selectCell,
    updateActiveCode,
    renameCell,
    addCell,
    deleteCell,
    moveCell,
    runCell,
    runAll,
    resetKernel,
    setHistoryIndex,
    restoreHistoryCode,
    exportScript,
    importScript,
  }
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>
